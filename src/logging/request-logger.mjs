import fs from 'fs';
import path from 'path';
import winston from 'winston';

const logFilePath = path.join(process.cwd(), 'logs', 'request.log');
fs.mkdirSync(path.dirname(logFilePath), {recursive: true});

class RequestLogger {
    constructor() {
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp({format: 'YYYY-MM-DD HH:mm:ss'}),
                winston.format.printf(({timestamp, message}) => `${timestamp} | ${message}`)
            ),
            transports: [
                new winston.transports.File({filename: logFilePath})
            ]
        });
    }

    async logRequest({time, ip, location, model, session}) {
        const baseInfo = `Time: ${time} | IP: ${ip} | Location: ${location} | Model: ${model} | Session: ${session}`;
        this.logger.info(baseInfo);
    }
}

export default RequestLogger;
