import { expect } from "chai";
import sinon from "sinon";
import { ResponseHandler } from "../../src/response/ResponseHandler";
import { TEST_CONFIG, RANDOM_TEST_GUID, TEST_TOKENS, TEST_URIS, TEST_DATA_CLIENT_INFO } from "../utils/StringConstants";
import { CacheHelpers } from "../../src/cache/CacheHelpers";
import { ICacheStorage } from "../../src/cache/ICacheStorage";
import { ICrypto, PkceCodes } from "../../src/crypto/ICrypto";
import { Logger, LogLevel } from "../../src/logger/Logger";
import { IdTokenClaims } from "../../src/auth/IdTokenClaims";
import { IdToken } from "../../src/auth/IdToken";
import { LoggerOptions } from "../../src/app/config/ModuleConfiguration";
import { Account } from "../../src/auth/Account";
import { TokenResponse } from "../../src/response/TokenResponse";

describe("ResponseHandler.ts Class Unit Tests", () => {

    let store = {};
    let cacheStorage: ICacheStorage;
    let cacheHelpers: CacheHelpers;
    let cryptoInterface: ICrypto;
    let logger: Logger;
    let idToken: IdToken;
    let testAccount: Account;
    beforeEach(() => {
        cacheStorage = {
            setItem(key: string, value: string): void {
                store[key] = value;
            },
            getItem(key: string): string {
                return store[key];
            },
            removeItem(key: string): void {
                delete store[key];
            },
            containsKey(key: string): boolean {
                return !!store[key];
            },
            getKeys(): string[] {
                return Object.keys(store);
            },
            clear(): void {
                store = {};
            }
        };
        cacheHelpers = new CacheHelpers(cacheStorage);
        cryptoInterface = {
            createNewGuid(): string {
                return RANDOM_TEST_GUID;
            },
            base64Decode(input: string): string {
                return input;
            },
            base64Encode(input: string): string {
                switch (input) {
                    case "123-test-uid":
                        return "MTIzLXRlc3QtdWlk";
                    case "456-test-utid":
                        return "NDU2LXRlc3QtdXRpZA==";
                    default:
                        return input;
                }
            },
            async generatePkceCodes(): Promise<PkceCodes> {
                return {
                    challenge: TEST_CONFIG.TEST_CHALLENGE,
                    verifier: TEST_CONFIG.TEST_VERIFIER
                }
            }
        };
        const loggerOptions: LoggerOptions = {
            loggerCallback: (level: LogLevel, message: string, containsPii: boolean): void => {
                return;
            },
            piiLoggingEnabled: true,
            logLevel: LogLevel.Info
        };
        logger = new Logger(loggerOptions);
        const idTokenClaims: IdTokenClaims = {
            "ver": "2.0",
            "iss": `${TEST_URIS.DEFAULT_INSTANCE}9188040d-6c67-4c5b-b112-36a304b66dad/v2.0`,
            "sub": "AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ",
            "exp": "1536361411",
            "name": "Abe Lincoln",
            "preferred_username": "AbeLi@microsoft.com",
            "oid": "00000000-0000-0000-66f3-3332eca7ea81",
            "tid": "3338040d-6c67-4c5b-b112-36a304b66dad",
            "nonce": "123523"
        };
        sinon.stub(IdToken, "extractIdToken").returns(idTokenClaims);
        idToken = new IdToken(TEST_TOKENS.IDTOKEN_V2, cryptoInterface);
        testAccount = new Account(idTokenClaims.oid, TEST_DATA_CLIENT_INFO.TEST_HOME_ACCOUNT_ID, idTokenClaims, TEST_TOKENS.IDTOKEN_V2);
    });

    afterEach(() => {
        store = {};
        sinon.restore();
    });

    describe("Constructor", () => {

        it("Correctly creates a ResponseHandler object", () => {
            const responseHandler = new ResponseHandler(TEST_CONFIG.MSAL_CLIENT_ID, cacheStorage, cacheHelpers, cryptoInterface, logger);
            expect(responseHandler instanceof ResponseHandler).to.be.true;
        });
    });

    describe("setResponseIdToken()", () => {

        it("returns a tokenResponse with the idToken values filled in", () => {
            const tokenResponse: TokenResponse = {
                uniqueId: "",
                tenantId: "",
                scopes: ["openid", "profile"], 
                tokenType: TEST_CONFIG.TOKEN_TYPE_BEARER,
                idToken: "",
                idTokenClaims: null,
                accessToken: TEST_TOKENS.ACCESS_TOKEN,
                refreshToken: TEST_TOKENS.REFRESH_TOKEN,
                expiresOn: null,
                account: testAccount,
                userRequestState: TEST_CONFIG.STATE
            }

            const expectedTokenResponse: TokenResponse = {
                ...tokenResponse,
                uniqueId: idToken.claims.oid,
                tenantId: idToken.claims.tid,
                idToken: idToken.rawIdToken,
                idTokenClaims: idToken.claims,
                expiresOn: new Date(Number(idToken.claims.exp) * 1000)
            };
            expect(ResponseHandler.setResponseIdToken(tokenResponse, idToken)).to.be.deep.eq(expectedTokenResponse);
        });

        it("returns null if original response is null or empty", () => {
            expect(ResponseHandler.setResponseIdToken(null, null)).to.be.null;
        });

        it("returns originalResponse if no idTokenObj given", () => {
            const tokenResponse: TokenResponse = {
                uniqueId: "",
                tenantId: "",
                scopes: ["openid", "profile"], 
                tokenType: TEST_CONFIG.TOKEN_TYPE_BEARER,
                idToken: "",
                idTokenClaims: null,
                accessToken: TEST_TOKENS.ACCESS_TOKEN,
                refreshToken: TEST_TOKENS.REFRESH_TOKEN,
                expiresOn: null,
                account: testAccount,
                userRequestState: TEST_CONFIG.STATE
            };
            expect(ResponseHandler.setResponseIdToken(tokenResponse, null)).to.be.deep.eq(tokenResponse);
        });
    });
}); 
