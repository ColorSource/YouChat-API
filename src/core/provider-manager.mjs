import YouProvider from '../providers/you/you-provider.mjs';

class ProviderManager {
    constructor(config) {
        if (!config) {
            throw new Error('ProviderManager requires a config object.');
        }
        this.config = config;
        this.provider = new YouProvider(this.config);
        console.log('Initialized with you provider.');
    }

    async init() {
        await this.provider.init(this.config);
        console.log('Provider initialized.');
    }

    async getCompletion(params) {
        return this.provider.getCompletion(params);
    }

    getCurrentProvider() {
        return this.provider.constructor.name;
    }

    getLogger() {
        return this.provider.logger;
    }

    getSessionManager() {
        return this.provider.sessionManager;
    }
}

export default ProviderManager;
