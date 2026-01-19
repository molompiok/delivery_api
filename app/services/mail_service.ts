import edge from 'edge.js'
import mail from '@adonisjs/mail/services/main'
import env from '../../start/env.js'
import logger from '@adonisjs/core/services/logger'

interface SendMailOptions {
    to: string
    subject: string
    text?: string
    html?: string
    template?: string
    context?: Record<string, any>
}

class MailService {
    private mailFromAddress: string
    private mailFromName: string

    constructor() {
        this.mailFromAddress = env.get('MAIL_FROM_ADDRESS', 'noreply@sublymus.com')
        this.mailFromName = env.get('MAIL_FROM_NAME', 'Sublymus Delivery')
    }

    async send(options: SendMailOptions): Promise<void> {
        const { to, subject, text, html, template, context } = options

        try {
            await mail.send(async (message) => {
                message
                    .to(to)
                    .from(this.mailFromAddress, this.mailFromName)
                    .subject(subject)

                if (template) {
                    try {
                        const renderedHtml = await edge.render(template, context || {})
                        message.html(renderedHtml)
                    } catch (renderError) {
                        logger.error({ template, context, error: renderError }, 'Error rendering Edge template')
                        throw new Error(`Error rendering template ${template}: ${renderError.message}`)
                    }
                } else if (html) {
                    message.html(html)
                } else if (text) {
                    message.text(text)
                }
            })

            logger.info({ mailTo: to, subject }, 'Email sent successfully.')
        } catch (error) {
            logger.error({ mailTo: to, subject, error: error.message }, 'Failed to send email')
            throw error
        }
    }
}

export default new MailService()
