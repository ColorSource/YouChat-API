import path from "path";
import fs from "fs";
import {Mutex} from 'async-mutex';

class Logger {
    constructor() {
        this.logMutex = new Mutex();
        this.logFilePath = path.join(process.cwd(), 'logs', 'provider-requests.log');
        fs.mkdirSync(path.dirname(this.logFilePath), {recursive: true});
        this.statistics = {};
        this.monthStart = this.getMonthStart();
        this.today = this.getToday();
        this.loadStatistics();
    }

    getMonthStart() {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        monthStart.setHours(0, 0, 0, 0);
        return monthStart;
    }

    getToday() {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        today.setHours(0, 0, 0, 0);
        return today;
    }

    loadStatistics() {
        this.logMutex.runExclusive(() => {
            if (!fs.existsSync(this.logFilePath)) {
                fs.writeFileSync(this.logFilePath, '', 'utf8');
                return;
            }
            const data = fs.readFileSync(this.logFilePath, 'utf-8');
            const entries = data.split('\n').filter(line => line.trim());
            const validEntries = [];

            for (const line of entries) {
                try {
                    const logEntry = JSON.parse(line);

                    if (!logEntry.provider) logEntry.provider = 'you';
                    if (!logEntry.email) logEntry.email = 'unknown';
                    if (!logEntry.mode) logEntry.mode = 'default';
                    if (logEntry.model === undefined) logEntry.model = 'unknown';
                    if (logEntry.completed === undefined) logEntry.completed = false;
                    if (logEntry.unusualQueryVolume === undefined) logEntry.unusualQueryVolume = false;

                    const logEntryArray = [
                        ['provider', logEntry.provider],
                        ['email', logEntry.email],
                        ['time', logEntry.time],
                        ['mode', logEntry.mode],
                        ['model', logEntry.model],
                        ['completed', logEntry.completed],
                        ['unusualQueryVolume', logEntry.unusualQueryVolume],
                    ];
                    validEntries.push(Object.fromEntries(logEntryArray));
                } catch (e) {
                    console.warn(`Skip invalid log entry: ${line}`);
                }
            }

            for (const logEntry of validEntries) {
                const logDate = new Date(logEntry.time);
                const provider = logEntry.provider;
                const email = logEntry.email;

                if (!this.statistics[provider]) this.statistics[provider] = {};

                if (!this.statistics[provider][email]) {
                    this.statistics[provider][email] = {
                        allRequests: [],
                        monthlyRequests: [],
                        dailyRequests: [],
                        monthlyStats: {
                            totalRequests: 0,
                            defaultModeCount: 0,
                            customModeCount: 0,
                            modelCount: {},
                        },
                        dailyStats: {
                            totalRequests: 0,
                            defaultModeCount: 0,
                            customModeCount: 0,
                            modelCount: {},
                        }
                    };
                }

                const stats = this.statistics[provider][email];
                stats.allRequests.push(logEntry);

                if (logDate >= this.monthStart) {
                    stats.monthlyRequests.push(logEntry);
                    this.updateStatistics(stats.monthlyStats, logEntry);
                }

                if (logDate >= this.today) {
                    stats.dailyRequests.push(logEntry);
                    this.updateStatistics(stats.dailyStats, logEntry);
                }
            }

            for (const provider in this.statistics) {
                for (const email in this.statistics[provider]) {
                    const stats = this.statistics[provider][email];
                    stats.allRequests.sort((a, b) => new Date(b.time) - new Date(a.time));
                    stats.monthlyRequests.sort((a, b) => new Date(b.time) - new Date(a.time));
                    stats.dailyRequests.sort((a, b) => new Date(b.time) - new Date(a.time));
                }
            }

            const cleanedData = validEntries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
            fs.writeFileSync(this.logFilePath, cleanedData);
        }).catch(err => {
            console.error('loadStatistics() lock error:', err);
        });
    }

    updateStatistics(stats, logEntry) {
        stats.totalRequests++;
        if (logEntry.mode === 'default') {
            stats.defaultModeCount++;
        } else if (logEntry.mode === 'custom') {
            stats.customModeCount++;
        }

        if (logEntry.model) {
            if (!stats.modelCount[logEntry.model]) stats.modelCount[logEntry.model] = 0;
            stats.modelCount[logEntry.model]++;
        }
    }

    logRequest({provider, email, time, mode, model, completed, unusualQueryVolume}) {
        const logEntryArray = [
            ['provider', provider || 'you'],
            ['email', email || 'unknown'],
            ['time', time],
            ['mode', mode || 'unknown'],
            ['model', model || 'unknown'],
            ['completed', completed ?? false],
            ['unusualQueryVolume', unusualQueryVolume ?? false],
        ];
        const logEntry = Object.fromEntries(logEntryArray);

        this.logMutex.runExclusive(async () => {
            await fs.promises.appendFile(this.logFilePath, JSON.stringify(logEntry) + '\n');

            const logDate = new Date(logEntry.time);
            const providerName = logEntry.provider;
            if (!this.statistics[providerName]) this.statistics[providerName] = {};

            const userEmail = logEntry.email;
            if (!this.statistics[providerName][userEmail]) {
                this.statistics[providerName][userEmail] = {
                    allRequests: [],
                    monthlyRequests: [],
                    dailyRequests: [],
                    monthlyStats: {
                        totalRequests: 0,
                        defaultModeCount: 0,
                        customModeCount: 0,
                        modelCount: {},
                    },
                    dailyStats: {
                        totalRequests: 0,
                        defaultModeCount: 0,
                        customModeCount: 0,
                        modelCount: {},
                    }
                };
            }

            const stats = this.statistics[providerName][userEmail];
            stats.allRequests.push(logEntry);

            if (logDate >= this.today) {
                stats.dailyRequests.push(logEntry);
                this.updateStatistics(stats.dailyStats, logEntry);
            }

            if (logDate >= this.monthStart) {
                stats.monthlyRequests.push(logEntry);
                this.updateStatistics(stats.monthlyStats, logEntry);
            }
        }).catch(err => {
            console.error('logRequest() lock error:', err);
        });
    }

    printStatistics() {
        const provider = 'you';
        const monthStartStr = this.monthStart.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const todayStr = this.today.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        if (!this.statistics[provider]) {
            console.log(`===== No statistics for provider: ${provider} =====`);
            return;
        }
        const emails = Object.keys(this.statistics[provider]).sort();
        let hasAnyDailyRequest = false;

        console.log(`===== Request Statistics (Provider=${provider}) =====`);

        for (const email of emails) {
            const stats = this.statistics[provider][email];
            if (stats.dailyStats.totalRequests > 0) {
                hasAnyDailyRequest = true;
                console.log(`User email: ${email}`);
                console.log(`---------- Monthly stats (since ${monthStartStr}) ----------`);
                console.log(`Total requests: ${stats.monthlyStats.totalRequests}`);
                console.log(`Default mode requests: ${stats.monthlyStats.defaultModeCount}`);
                console.log(`Custom mode requests: ${stats.monthlyStats.customModeCount}`);
                console.log('Model request counts:');
                for (const [mdl, count] of Object.entries(stats.monthlyStats.modelCount)) {
                    console.log(`  - ${mdl}: ${count}`);
                }

                console.log(`---------- Today (${todayStr}) ----------`);
                console.log(`Total requests: ${stats.dailyStats.totalRequests}`);
                console.log(`Default mode requests: ${stats.dailyStats.defaultModeCount}`);
                console.log(`Custom mode requests: ${stats.dailyStats.customModeCount}`);
                console.log('Model request counts:');
                for (const [mdl, count] of Object.entries(stats.dailyStats.modelCount)) {
                    console.log(`  - ${mdl}: ${count}`);
                }
                console.log('----------------------------------------');
            }
        }

        if (!hasAnyDailyRequest) {
            console.log(`===== No requests today (${todayStr}) =====`);
        }

        console.log('==========================================');
    }
}

export default Logger;
