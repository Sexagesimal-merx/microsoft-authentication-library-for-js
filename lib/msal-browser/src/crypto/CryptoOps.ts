/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { ICrypto, PkceCodes, SignedHttpRequest, SignedHttpRequestParameters, CryptoKeyTypes, Logger, BoundServerAuthorizationTokenResponse, BaseAuthRequest, ServerAuthorizationTokenResponse } from "@azure/msal-common";
import { GuidGenerator } from "./GuidGenerator";
import { Base64Encode } from "../encode/Base64Encode";
import { Base64Decode } from "../encode/Base64Decode";
import { PkceGenerator } from "./PkceGenerator";
import { BrowserCrypto, CryptoKeyOptions } from "./BrowserCrypto";
import { BrowserStringUtils } from "../utils/BrowserStringUtils";
import { CryptoKeyFormats, CryptoKeyConfig } from "../utils/CryptoConstants";
import { BrowserAuthError } from "../error/BrowserAuthError";
import { AsyncMemoryStorage } from "../cache/AsyncMemoryStorage";
import { BoundTokenResponse } from "./BoundTokenResponse";
import { DBTableNames } from "../utils/BrowserConstants";

export type CachedKeyPair = {
    publicKey: CryptoKey,
    privateKey: CryptoKey,
    requestMethod?: string,
    requestUri?: string
};

/**
 * MSAL CryptoKeyStore DB Version 2
 */
export type CryptoKeyStore = {
    asymmetricKeys: AsyncMemoryStorage<CachedKeyPair>;
    symmetricKeys: AsyncMemoryStorage<CryptoKey>;
};

/**
 * This class implements MSAL's crypto interface, which allows it to perform base64 encoding and decoding, generating cryptographically random GUIDs and 
 * implementing Proof Key for Code Exchange specs for the OAuth Authorization Code Flow using PKCE (rfc here: https://tools.ietf.org/html/rfc7636).
 */
export class CryptoOps implements ICrypto {

    private browserCrypto: BrowserCrypto;
    private guidGenerator: GuidGenerator;
    private b64Encode: Base64Encode;
    private b64Decode: Base64Decode;
    private pkceGenerator: PkceGenerator;
    private logger: Logger;

    private static EXTRACTABLE: boolean = true;
    private cache: CryptoKeyStore;

    constructor(logger: Logger) {
        this.logger = logger;
        // Browser crypto needs to be validated first before any other classes can be set.
        this.browserCrypto = new BrowserCrypto(this.logger);
        this.b64Encode = new Base64Encode();
        this.b64Decode = new Base64Decode();
        this.guidGenerator = new GuidGenerator(this.browserCrypto);
        this.pkceGenerator = new PkceGenerator(this.browserCrypto);
        this.cache = {
            asymmetricKeys: new AsyncMemoryStorage<CachedKeyPair>(DBTableNames.asymmetricKeys, this.logger),
            symmetricKeys: new AsyncMemoryStorage<CryptoKey>(DBTableNames.symmetricKeys, this.logger)
        };
    }

    /**
     * Creates a new random GUID - used to populate state and nonce.
     * @returns string (GUID)
     */
    createNewGuid(): string {
        return this.guidGenerator.generateGuid();
    }

    /**
     * Encodes input string to base64.
     * @param input 
     */
    base64Encode(input: string): string {
        return this.b64Encode.encode(input);
    }    
    
    /**
     * Decodes input string from base64.
     * @param input 
     */
    base64Decode(input: string): string {
        return this.b64Decode.decode(input);
    }

    /**
     * Generates PKCE codes used in Authorization Code Flow.
     */
    async generatePkceCodes(): Promise<PkceCodes> {
        return this.pkceGenerator.generateCodes();
    }

    /**
     * Generates a keypair, stores it and returns a thumbprint
     * @param request
     */
    async getPublicKeyThumbprint(request: SignedHttpRequestParameters, keyType?: CryptoKeyTypes): Promise<string> {
        let keyOptions: CryptoKeyOptions;

        switch(keyType) {
            case CryptoKeyTypes.StkJwk:
                keyOptions = CryptoKeyConfig.RefreshTokenBinding;
                break;
            default:
                keyOptions = CryptoKeyConfig.AccessTokenBinding;
                break;
        }
        
        // Generate Keypair
        const keyPair: CryptoKeyPair = await this.browserCrypto.generateKeyPair(keyOptions, CryptoOps.EXTRACTABLE);

        if (!keyPair || !keyPair.publicKey || !keyPair.privateKey) {
            throw BrowserAuthError.createKeyGenerationFailedError();
        }

        // Generate Thumbprint for Public Key
        const publicKeyJwk: JsonWebKey = await this.browserCrypto.exportJwk(keyPair.publicKey);
        const publicJwkHashBytes = await this.browserCrypto.generateJwkThumbprintHash(publicKeyJwk);
        const publicJwkHash = this.b64Encode.urlEncodeArr(publicJwkHashBytes);
        
        // Generate Thumbprint for Private Key
        const privateKeyJwk: JsonWebKey = await this.browserCrypto.exportJwk(keyPair.privateKey);
        // Re-import private key to make it unextractable
        const unextractablePrivateKey: CryptoKey = await this.browserCrypto.importJwk(keyOptions, privateKeyJwk, false, keyOptions.privateKeyUsage);

        // Store Keypair data in keystore
        await this.cache.asymmetricKeys.setItem(
            publicJwkHash, 
            {
                privateKey: unextractablePrivateKey,
                publicKey: keyPair.publicKey,
                requestMethod: request.resourceRequestMethod,
                requestUri: request.resourceRequestUri
            }
        );

        return publicJwkHash;
    }

    /**
     * Removes cryptographic keypair from key store matching the keyId passed in
     * @param kid 
     */
    async removeTokenBindingKey(kid: string): Promise<boolean> {
        await this.cache.asymmetricKeys.removeItem(kid);
        const keyFound = await this.cache.asymmetricKeys.containsKey(kid);
        return !keyFound;
    }

    /**
     * Removes all cryptographic keys from IndexedDB storage
     */
    async clearKeystore(): Promise<boolean> {
        const dataStoreNames = Object.keys(this.cache);
        const databaseStorage = this.cache[dataStoreNames[0]];
        return databaseStorage ? await databaseStorage.deleteDatabase() : false;
    }

    /**
     * Signs the given object as a jwt payload with private key retrieved by given kid.
     * @param payload 
     * @param kid 
     */
    async signJwt(payload: SignedHttpRequest, kid: string): Promise<string> {
        const cachedKeyPair = await this.cache.asymmetricKeys.getItem(kid);
        
        if (!cachedKeyPair) {
            throw BrowserAuthError.createSigningKeyNotFoundInStorageError();
        }

        // Get public key as JWK
        const publicKeyJwk = await this.browserCrypto.exportJwk(cachedKeyPair.publicKey);
        const publicKeyJwkString = BrowserCrypto.getJwkString(publicKeyJwk);

        // Generate header
        const header = {
            alg: publicKeyJwk.alg,
            type: CryptoKeyFormats.jwk
        };
        const encodedHeader = this.b64Encode.urlEncode(JSON.stringify(header));

        // Generate payload
        payload.cnf = {
            jwk: JSON.parse(publicKeyJwkString)
        };
        const encodedPayload = this.b64Encode.urlEncode(JSON.stringify(payload));

        // Form token string
        const tokenString = `${encodedHeader}.${encodedPayload}`;

        // Sign token
        const tokenBuffer = BrowserStringUtils.stringToArrayBuffer(tokenString);
        const signatureBuffer = await this.browserCrypto.sign(CryptoKeyConfig.AccessTokenBinding, cachedKeyPair.privateKey, tokenBuffer);
        const encodedSignature = this.b64Encode.urlEncodeArr(new Uint8Array(signatureBuffer));

        return `${tokenString}.${encodedSignature}`;
    }

    /**
     * Returns the public key from an asymmetric key pair stored in IndexedDB based on the
     * public key thumbprint parameter
     * @param keyThumbprint 
     * @returns Public Key JWK string
     */
    async getAsymmetricPublicKey(keyThumbprint: string): Promise<string> {
        const cachedKeyPair = await this.cache.asymmetricKeys.getItem(keyThumbprint);

        if (!cachedKeyPair) {
            throw BrowserAuthError.createSigningKeyNotFoundInStorageError();
        }

        // Get public key as JWK
        const publicKeyJwk = await this.browserCrypto.exportJwk(cachedKeyPair.publicKey);
        return BrowserCrypto.getJwkString(publicKeyJwk);
    }

    /**
     * Returns the decrypted server token response
     * @param boundServerTokenResponse 
     * @param request 
     */
    async decryptBoundTokenResponse(
        boundServerTokenResponse: BoundServerAuthorizationTokenResponse,
        request: BaseAuthRequest): Promise<ServerAuthorizationTokenResponse> {
        const boundResponse = new BoundTokenResponse(boundServerTokenResponse, request, this.cache, this.browserCrypto, this.logger);
        return await boundResponse.decrypt();
    }
}
