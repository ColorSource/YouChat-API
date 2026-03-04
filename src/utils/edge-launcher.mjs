import {execSync} from 'child_process';
import fs from 'fs';
import os from 'os';
import {chromium} from 'playwright';
import {setupBrowserFingerprint} from './browser-fingerprint.mjs';

/**
 * 使用 Playwright 启动 Edge 持久化上下文。
 * @param {string} userDataDir 用户数据目录
 * @param {string} edgePath Edge 可执行文件路径
 * @returns {Promise<object>} 包含 browser/context/page
 */
export async function launchEdgeBrowser(userDataDir, edgePath) {
    if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, {recursive: true});
    }

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        executablePath: edgePath,
        viewport: {width: 1280, height: 850},
        args: [
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-popup-blocking',
            '--disable-infobars',
            '--disable-translate',
            '--disable-sync',
            '--window-size=1280,850',
            '--force-device-scale-factor=1',
        ],
    });

    let page = context.pages()[0];
    if (!page || page.isClosed()) {
        page = await context.newPage();
    }

    const fingerprint = await setupBrowserFingerprint(page, 'edge');
    return {
        browser: context.browser(),
        context,
        page,
        fingerprint,
    };
}

/**
 * 查找系统中的 Edge 浏览器路径
 * @returns {string|null}
 */
export function findEdgePath() {
    const platform = os.platform();

    if (platform === 'win32') {
        const commonPaths = [
            `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
            `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
            `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
        ];

        for (const candidate of commonPaths) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    } else if (platform === 'darwin') {
        const macPath = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
        if (fs.existsSync(macPath)) {
            return macPath;
        }
    } else {
        try {
            const stdout = execSync('which microsoft-edge', {encoding: 'utf8'});
            if (stdout && stdout.trim()) {
                return stdout.trim();
            }
        } catch (error) {
            return null;
        }
    }
    return null;
}
