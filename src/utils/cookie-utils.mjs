import * as docx from "docx";
import cookie from "cookie";
import fs from "fs";
import {execSync} from "child_process";

function getGitRevision() {
    // get git revision and branch
    try {
        const revision = execSync("git rev-parse --short HEAD", {stdio: "pipe"}).toString().trim();
        const branch = execSync("git rev-parse --abbrev-ref HEAD", {stdio: "pipe"}).toString().trim();
        return {revision, branch};
    } catch (e) {
        return {revision: "unknown", branch: "unknown"};
    }
}

// 创建目录
function createDirectoryIfNotExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, {recursive: true});
    }
}

function extractCookie(cookies) {
    let jwtSession = null;
    let jwtToken = null;
    let ds = null;
    let dsr = null;
    let gst = null;
    let gid = null;
    let you_subscription = null;
    let youpro_subscription = null;

    const parsed = cookie.parse(cookies);
    if (parsed["stytch_session"]) jwtSession = parsed["stytch_session"];
    if (parsed["stytch_session_jwt"]) jwtToken = parsed["stytch_session_jwt"];
    if (parsed["DS"]) ds = parsed["DS"];
    if (parsed["DSR"]) dsr = parsed["DSR"];
    if (parsed["gst"]) gst = parsed["gst"];
    if (parsed["gid"]) gid = parsed["gid"];
    if (parsed["you_subscription"]) you_subscription = parsed["you_subscription"];
    if (parsed["youpro_subscription"]) youpro_subscription = parsed["youpro_subscription"];

    // 尝试从 ld_context 中提取邮箱
    let email = null;
    if (parsed["ld_context"]) {
        try {
            const ldContext = JSON.parse(decodeURIComponent(parsed["ld_context"]));
            email = ldContext.email || null;
        } catch (e) {}
    }

    return {jwtSession, jwtToken, ds, dsr, gst, gid, you_subscription, youpro_subscription, email};
}

function getSessionCookie(
    jwtSession,
    jwtToken,
    ds,
    dsr,
    you_subscription,
    youpro_subscription,
    gst,
    gid,
    rawCookieString
) {
    const cookieMap = new Map();
    const defaultCookieShape = {
        url: "https://you.com",
        path: "/",
        expires: 1800000000,
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
    };

    const setCookieValue = (name, value, overrides = {}) => {
        if (!name || value === undefined || value === null || value === "") {
            return;
        }
        cookieMap.set(name, {
            name,
            value: String(value),
            ...defaultCookieShape,
            ...overrides,
        });
    };

    if (rawCookieString && typeof rawCookieString === "string") {
        for (const part of rawCookieString.split(";")) {
            const token = part.trim();
            if (!token) continue;
            const idx = token.indexOf("=");
            if (idx <= 0) continue;
            const name = token.slice(0, idx).trim();
            const value = token.slice(idx + 1).trim();
            setCookieValue(name, value);
        }
    }

    if (jwtSession && jwtToken) {
        setCookieValue("stytch_session", jwtSession);
        setCookieValue("ydc_stytch_session", jwtSession, {httpOnly: true});
        setCookieValue("stytch_session_jwt", jwtToken);
        setCookieValue("ydc_stytch_session_jwt", jwtToken, {httpOnly: true});
    }

    setCookieValue("DS", ds);
    setCookieValue("DSR", dsr);
    setCookieValue("gst", gst);
    setCookieValue("gid", gid);
    setCookieValue("you_subscription", you_subscription);
    setCookieValue("youpro_subscription", youpro_subscription);

    if (process.env.INCOGNITO_MODE === "true") {
        setCookieValue("incognito", "true", {sameSite: undefined});
    }

    return Array.from(cookieMap.values());
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDocx(content) {
    let paragraphs = [];
    content.split("\n").forEach((line) => {
        paragraphs.push(
            new docx.Paragraph({
                children: [new docx.TextRun(line)],
            })
        );
    });
    let doc = new docx.Document({
        sections: [
            {
                properties: {},
                children: paragraphs,
            },
        ],
    });
    return docx.Packer.toBuffer(doc).then((buffer) => buffer);
}

// eventStream util
function createEvent(event, data) {
    // if data is object, stringify it
    if (typeof data === "object") {
        data = JSON.stringify(data);
    }
    return `event: ${event}\ndata: ${data}\n\n`;
}

export {
    createEvent,
    createDirectoryIfNotExists,
    sleep,
    extractCookie,
    getSessionCookie,
    createDocx,
    getGitRevision
};
