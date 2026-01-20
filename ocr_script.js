import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import { createWorker } from 'tesseract.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

async function getAuthenticatedClient() {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const credentials = JSON.parse(content);
    const { client_secret, client_id } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3000');
    const token = await fs.readFile(TOKEN_PATH);
    oAuth2Client.setCredentials(JSON.parse(token));
    return oAuth2Client;
}

async function run() {
    try {
        const auth = await getAuthenticatedClient();
        const gmail = google.gmail({ version: 'v1', auth });

        const messageId = '19bd8badc5a28dcf';
        const attachmentId = 'ANGjdJ-Ucl7ETma16qIkp9q1JEwaNyFnFvDYF-KbtWkj8Z2wsuIwAk4Vp3oKoPZRf1CJ6t2Oc6kQFYeY0aS8Ghkg_h2t8KVXmGqCzNS1j_EQ6hwwnwhW-p9F2oeaHTjBrAh4ELnDZWAqDMPpMIKsNXYhuYfylm0Lb24T_eEmmLr_VUA67ZFENReK4W8B8e8-PoS43DzNh9w_OxbJq_WgNgA6a60_K9Xf0P97AZql5GaTWJqGi4ZuPuLntsM3G2Bp96FtIgJ4Dg_t29M5LF7GY9aTU1zga7ktA0EAa2Pg0p7XSpCDATwwxgRbqv4TffE';

        console.log("Fetching attachment...");
        const res = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: messageId,
            id: attachmentId
        });

        if (!res.data || !res.data.data) {
            throw new Error("No attachment data found.");
        }

        const buffer = Buffer.from(res.data.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        console.log(`Got buffer of size ${buffer.length}`);

        console.log("Initializing Tesseract...");
        // Use local traineddata if possible, or default download
        const worker = await createWorker('eng');

        console.log("Recognizing text...");
        const ret = await worker.recognize(buffer);
        console.log("--- EXTRACTED TEXT ---");
        console.log(ret.data.text);
        console.log("----------------------");

        await worker.terminate();

    } catch (error) {
        console.error("Error:", error);
    }
}

run();
