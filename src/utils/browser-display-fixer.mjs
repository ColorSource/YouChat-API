/**
 * @param {Object} page - browser page
 * @param {Object} options - 閰嶇疆閫夐」
 * @param {number} options.width - 瑙嗗彛瀹藉害
 * @param {number} options.height - 瑙嗗彛楂樺害
 * @param {number} options.deviceScaleFactor - 璁惧缂╂斁鍥犲瓙
 * @param {boolean} options.isMobile - 妯℃嫙绉诲姩璁惧
 * @param {boolean} options.hasTouch - 鏀寔瑙︽懜
 * @param {boolean} options.isLandscape - 妯睆
 * @returns {Promise<void>}
 */
async function createCdpSession(page) {
    if (!page) {
        return null;
    }
    const context = typeof page.context === 'function' ? page.context() : null;
    if (context && typeof context.newCDPSession === 'function') {
        return context.newCDPSession(page);
    }
    if (typeof page.target === 'function') {
        const target = page.target();
        if (target && typeof target.createCDPSession === 'function') {
            return target.createCDPSession();
        }
    }
    return null;
}

export async function fixBrowserDisplay(page, options = {}) {
    if (!page) {
        console.error('Page object is empty. Cannot fix display.');
        return;
    }

    const defaultOptions = {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        isLandscape: true
    };

    const settings = {...defaultOptions, ...options};

    try {
        // 璁剧疆瑙嗗彛澶у皬鍜岃澶囨瘮渚?
        if (typeof page.setViewportSize === 'function') {
            await page.setViewportSize({
                width: settings.width,
                height: settings.height,
            });
        } else if (typeof page.setViewport === 'function') {
            await page.setViewport({
                width: settings.width,
                height: settings.height,
                deviceScaleFactor: settings.deviceScaleFactor,
                isMobile: settings.isMobile,
                hasTouch: settings.hasTouch,
                isLandscape: settings.isLandscape
            });
        }

        // 灏濊瘯璋冩暣绐楀彛澶у皬
        const session = await createCdpSession(page);
        if (session) {
            await session.send('Emulation.setDeviceMetricsOverride', {
                width: settings.width,
                height: settings.height,
                deviceScaleFactor: settings.deviceScaleFactor,
                mobile: settings.isMobile,
                screenWidth: settings.width,
                screenHeight: settings.height
            });
        }

        // 閲嶇疆椤甸潰缂╂斁
        await page.evaluate(() => {
            document.body.style.zoom = '100%';
            document.body.style.transform = 'scale(1)';
            document.body.style.transformOrigin = '0 0';

            // 灏濊瘯淇鍙兘瀛樺湪鐨凜SS
            const styleElement = document.createElement('style');
            styleElement.textContent = `
                html, body {
                    width: 100% !important;
                    height: 100% !important;
                    overflow: auto !important;
                }

                .container, .main, #app, #root {
                    max-width: 100% !important;
                    width: auto !important;
                }
            `;
            document.head.appendChild(styleElement);

            window.dispatchEvent(new Event('resize'));
        });

    } catch (error) {
        console.error('Failed to fix browser display:', error);
    }
}

/**
 * 璋冩暣CSS姣斾緥
 * @param {Object} page - browser page
 * @param {number} scale - 缂╂斁姣斾緥
 * @returns {Promise<void>}
 */
export async function adjustCssScaling(page, scale = 1) {
    if (!page) return;

    try {
        await page.evaluate((scale) => {
            const styleElem = document.createElement('style');
            styleElem.id = 'puppeteer-display-fix';
            styleElem.textContent = `
                html {
                    transform: scale(${scale});
                    transform-origin: top left;
                    width: ${100 / scale}% !important;
                    height: ${100 / scale}% !important;
                }
            `;
            document.head.appendChild(styleElem);

            // 閲嶆柊璁＄畻甯冨眬
            window.dispatchEvent(new Event('resize'));
        }, scale);
    } catch (error) {
        console.error('Failed to adjust CSS scaling:', error);
    }
}

/**
 * 淇楂楧PI
 * @param {Object} page - browser page
 * @returns {Promise<void>}
 */
export async function fixHighDpiDisplay(page) {
    if (!page) return;

    try {
        // 妫€娴嬭澶囧儚绱犳瘮
        const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);

        if (devicePixelRatio > 1) {
            if (typeof page.setViewportSize === 'function') {
                await page.setViewportSize({
                    width: 1280,
                    height: 800
                });
            } else if (typeof page.setViewport === 'function') {
                await page.setViewport({
                    width: 1280,
                    height: 800,
                    deviceScaleFactor: devicePixelRatio
                });
            }

            const session = await createCdpSession(page);
            if (session) {
                await session.send('Emulation.setDeviceMetricsOverride', {
                    width: 1280,
                    height: 800,
                    deviceScaleFactor: devicePixelRatio,
                    mobile: false,
                });
            }

            await page.evaluate((dpr) => {
                const meta = document.createElement('meta');
                meta.setAttribute('name', 'viewport');
                meta.setAttribute('content', `initial-scale=1, minimum-scale=1, maximum-scale=1, width=device-width, height=device-height, target-densitydpi=device-dpi, user-scalable=no`);
                document.head.appendChild(meta);
            }, devicePixelRatio);
        }
    } catch (error) {
        console.error('Failed to fix high-DPI display:', error);
    }
}

/**
 * 瀹屾暣娴忚鍣ㄦ樉绀轰紭鍖?
 * @param {Object} page - browser page
 * @param {Object} options - 閰嶇疆
 * @returns {Promise<void>}
 */
export async function optimizeBrowserDisplay(page, options = {}) {
    const defaultOptions = {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        cssScale: null,
        fixHighDpi: true,
        forceResize: true
    };

    const config = {...defaultOptions, ...options};

    try {
        // 鍩烘湰鏄剧ず淇
        await fixBrowserDisplay(page, {
            width: config.width,
            height: config.height,
            deviceScaleFactor: config.deviceScaleFactor
        });

        // 淇楂楧PI鏄剧ず
        if (config.fixHighDpi) {
            await fixHighDpiDisplay(page);
        }

        if (config.cssScale !== null) {
            await adjustCssScaling(page, config.cssScale);
        }

        // 濡傛灉寮哄埗璋冩暣绐楀彛澶у皬
        if (config.forceResize && !config.isHeadless) {
            try {
                const client = await createCdpSession(page);
                if (!client) {
                    throw new Error('CDP session unavailable');
                }
                const {windowId} = await client.send('Browser.getWindowForTarget');
                await client.send('Browser.setWindowBounds', {
                    windowId,
                    bounds: {
                        width: config.width,
                        height: config.height
                    }
                });
            } catch (resizeError) {
                // console.log('鏃犳硶璋冩暣绐楀彛澶у皬:', resizeError.message);

                try {
                    await page.evaluate(({width, height}) => {
                        window.resizeTo(width, height);
                    }, {width: config.width, height: config.height});
                } catch (altError) {
                    console.log('Fallback resize failed:', altError.message);
                }
            }
        }

    } catch (error) {
        console.error('Browser display optimization failed:', error);
    }
}
