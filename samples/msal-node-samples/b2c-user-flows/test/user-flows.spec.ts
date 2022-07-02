/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import puppeteer from "puppeteer";

import { Screenshot, createFolder, setupCredentials } from "../../../e2eTestUtils/TestUtils";
import { NodeCacheTestUtils } from "../../../e2eTestUtils/NodeCacheTestUtils";
import { LabClient } from "../../../e2eTestUtils/LabClient";
import { LabApiQueryParams } from "../../../e2eTestUtils/LabApiQueryParams";
import { AppTypes, AzureEnvironments, B2cProviders, UserTypes } from "../../../e2eTestUtils/Constants";
import {
    b2cLocalAccountEnterCredentials,
    SCREENSHOT_BASE_FOLDER_NAME,
    validateCacheLocation,
    SAMPLE_HOME_URL
 } from "../../testUtils";

import { PublicClientApplication } from "../../../../lib/msal-node/dist";

// Set test cache name/location
const TEST_CACHE_LOCATION = `${__dirname}/../data/b2c.cache.json`;

// Get flow-specific routes from sample application
const main = require("../index");

// Build cachePlugin
const cachePlugin = require("../../cachePlugin.js")(TEST_CACHE_LOCATION);

// Load scenario configuration
const config = require("../config/B2C.json");

describe("B2C User Flow Tests", () => {
    jest.retryTimes(1);
    jest.setTimeout(45000);
    let browser: puppeteer.Browser;
    let context: puppeteer.BrowserContext;
    let page: puppeteer.Page;
    let port: string;
    let homeRoute: string;

    let username: string;
    let accountPwd: string;

    const screenshotFolder = `${SCREENSHOT_BASE_FOLDER_NAME}/user-flows/b2c`;

    beforeAll(async() => {
        await validateCacheLocation(TEST_CACHE_LOCATION);
        // @ts-ignore
        browser = await global.__BROWSER__;
        // @ts-ignore
        port = 3000;
        homeRoute = `http://localhost:${port}`;

        createFolder(screenshotFolder);

        const labApiParams: LabApiQueryParams = {
            userType: UserTypes.B2C,
            b2cProvider: B2cProviders.LOCAL
        };

        const labClient = new LabClient();
        const envResponse = await labClient.getVarsByCloudEnvironment(labApiParams);
        [username, accountPwd] = await setupCredentials(envResponse[0], labClient);
    });

    afterAll(async () => {
        await browser.close();
    });

    describe("User flows", () => {
        let publicClientApplication: PublicClientApplication;
        let server: any;

        beforeAll(async () => {
            publicClientApplication = new PublicClientApplication({
                auth: {
                    clientId: config.authOptions.clientId,
                    authority: config.policies.authorities.signUpSignIn.authority,
                    knownAuthorities: [config.policies.authorityDomain],
                },
                cache: {
                    cachePlugin
                }
            });

            server = main(config, publicClientApplication, port, config.authOptions.redirectUri);
            await NodeCacheTestUtils.resetCache(TEST_CACHE_LOCATION);
        });

        afterAll(async () => {
            if (server) {
                server.close();
            }
        });

        beforeEach(async () => {
            context = await browser.createIncognitoBrowserContext();
            page = await context.newPage();
            page.setDefaultTimeout(5000);
            page.on("dialog", async dialog => {
                console.log(dialog.message());
                await dialog.dismiss();
            });
        });

        afterEach(async () => {
            await page.close();
            await context.close();
            await NodeCacheTestUtils.resetCache(TEST_CACHE_LOCATION);
        });

        it("Performs edit profile", async () => {
            const screenshot = new Screenshot(`${screenshotFolder}/edit-profile`);
            await page.goto(homeRoute);
            await page.click("#signIn");
            await b2cLocalAccountEnterCredentials(page, screenshot, username, accountPwd);
            await page.waitForFunction(`window.location.href.startsWith("${SAMPLE_HOME_URL}")`);
            await page.click("#editProfile");
            await page.waitForSelector("#attributeVerification");
            let displayName = (Math.random() + 1).toString(36).substring(7); // generate a random string
            await page.$eval('#displayName', (el: any) => el.value = ''); // clear the text field
            await page.type("#displayName", `${displayName}`);
            await page.click("#continue");
            await page.waitForFunction(`window.location.href.startsWith("${SAMPLE_HOME_URL}")`);
            await page.click("#viewId");
            await page.waitForSelector("#idTokenInfo");
            const htmlBody = await page.evaluate(() => document.body.innerHTML);
            expect(htmlBody).toContain(`${displayName}`);
        });
    });
});
