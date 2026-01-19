import env from '../../start/env.js'
import logger from '@adonisjs/core/services/logger'

interface SendSmsOptions {
    to: string
    content: string
}

class SmsService {
    private sourceNumber: string
    private apiUrl: string
    private apiKey: string

    constructor() {
        this.sourceNumber = env.get('SMS_SOURCE_NUMBER')
        this.apiUrl = env.get('SMS_API_URL')
        this.apiKey = env.get('SMS_API_KEY')
    }

    async send({ to, content }: SendSmsOptions): Promise<boolean> {
        try {
            logger.info({ to, content }, 'Sending SMS...')

            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-Key': this.apiKey,
                },
                body: JSON.stringify({
                    from: this.sourceNumber,
                    to,
                    content,
                }),
            })

            if (!response.ok) {
                const errorBody = await response.text()
                logger.error({ status: response.status, body: errorBody }, 'SMS API Error')
                return false
            }

            const data = await response.json()
            logger.info({ response: data }, 'SMS Sent Successfully')
            return true
        } catch (error) {
            logger.error({ error: error.message }, 'Failed to send SMS')
            return false
        }
    }
}

export default new SmsService()
