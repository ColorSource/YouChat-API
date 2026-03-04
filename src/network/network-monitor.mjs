import dns from 'dns';
import { EventEmitter } from 'events';

class NetworkMonitor extends EventEmitter {
    constructor() {
        super();
        this.isBlocked = false;
        this.checkInterval = null;
    }

    async checkConnection() {
        return new Promise((resolve) => {
            dns.lookup('you.com', (err) => {
                if (err && err.code === 'ENOTFOUND') {
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
    }

    async startMonitoring() {
        console.log('Network monitoring started...');
        this.checkInterval = setInterval(async () => {
            const isConnected = await this.checkConnection();
            if (!isConnected && !this.isBlocked) {
                this.isBlocked = true;
                this.emit('networkDown');
                console.log('Network issue detected.');
            } else if (isConnected && this.isBlocked) {
                this.isBlocked = false;
                this.emit('networkUp');
                console.log('Network connection restored.');
            }
        }, 5000);
    }

    stopMonitoring() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    isNetworkBlocked() {
        return this.isBlocked;
    }
}

export default NetworkMonitor;
