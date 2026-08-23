import nodemailer from 'nodemailer';
import { formatRazorpayAmount } from '../config/razorpay';

interface NoticePayload {
  invoiceNumber: string;
  clientCompanyName: string;
  clientEmail: string;
  originalDueDate: string;
  breachedPtpDate?: string;
  principalAmount: number; // in paise
  curePeriodDays?: number; // default: 7 days
  annualInterestRate?: number; // default: 18%
  lateFeeFlatPaise?: number; // default: ₹1,000 (100000 paise)
  paymentLink: string;
}

export class LegalNoticeService {
  private static transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
    port: Number(process.env.SMTP_PORT) || 587,
    auth: {
      user: process.env.SMTP_USER || 'apikey',
      pass: process.env.SMTP_PASS || process.env.SENDGRID_API_KEY,
    },
  });

  public static calculatePenalty(
    principalPaise: number,
    dueDateStr: string,
    annualRate: number = 0.18,
    lateFeeFlatPaise: number = 100000
  ) {
    const dueDate = new Date(dueDateStr);
    const today = new Date();
    const diffTime = Math.max(0, today.getTime() - dueDate.getTime());
    const daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const dailyRate = annualRate / 365;
    const interestAccruedPaise = Math.round(principalPaise * dailyRate * daysOverdue);
    const totalPayablePaise = principalPaise + interestAccruedPaise + lateFeeFlatPaise;

    return {
      daysOverdue,
      interestAccruedFormatted: formatRazorpayAmount(interestAccruedPaise),
      lateFeeFormatted: formatRazorpayAmount(lateFeeFlatPaise),
      totalPayableFormatted: formatRazorpayAmount(totalPayablePaise),
      principalFormatted: formatRazorpayAmount(principalPaise),
      interestAccruedPaise,
      totalPayablePaise,
    };
  }

  public static async dispatchDemandNotice(payload: NoticePayload): Promise<boolean> {
    const cureDays = payload.curePeriodDays || 7;
    const cureDeadline = new Date();
    cureDeadline.setDate(cureDeadline.getDate() + cureDays);
    const formattedCureDate = cureDeadline.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const penalty = this.calculatePenalty(
      payload.principalAmount,
      payload.breachedPtpDate || payload.originalDueDate,
      payload.annualInterestRate || 0.18,
      payload.lateFeeFlatPaise || 100000
    );

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
        <div style="border-bottom: 2px solid #dc2626; padding-bottom: 12px; margin-bottom: 20px;">
          <h2 style="color: #dc2626; margin: 0;">FORMAL DEMAND & NOTICE OF OVERDUE SETTLEMENT</h2>
          <p style="font-size: 12px; color: #64748b; margin: 4px 0 0 0;">Reference: INV-${payload.invoiceNumber} | Stage: ESCALATED_LEGAL</p>
        </div>

        <p>Dear Finance Team at <strong>${payload.clientCompanyName}</strong>,</p>

        <p>This is a formal communication regarding Invoice <strong>#${payload.invoiceNumber}</strong>, which remains unsettled past the mutually agreed commitment date of <strong>${payload.breachedPtpDate || payload.originalDueDate}</strong> (${penalty.daysOverdue} days overdue).</p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
          <tr style="background-color: #f8fafc; border-bottom: 1px solid #cbd5e1;">
            <td style="padding: 10px;">Principal Outstanding</td>
            <td style="padding: 10px; text-align: right; font-weight: bold;">${penalty.principalFormatted}</td>
          </tr>
          <tr style="border-bottom: 1px solid #cbd5e1;">
            <td style="padding: 10px;">Accrued Interest (18% p.a. for ${penalty.daysOverdue} days)</td>
            <td style="padding: 10px; text-align: right; color: #b91c1c;">${penalty.interestAccruedFormatted}</td>
          </tr>
          <tr style="border-bottom: 1px solid #cbd5e1;">
            <td style="padding: 10px;">Breach Late Administrative Fee</td>
            <td style="padding: 10px; text-align: right; color: #b91c1c;">${penalty.lateFeeFormatted}</td>
          </tr>
          <tr style="background-color: #fef2f2; font-weight: bold; border-top: 2px solid #ef4444;">
            <td style="padding: 12px;">Total Amount Due</td>
            <td style="padding: 12px; text-align: right; color: #b91c1c; font-size: 16px;">${penalty.totalPayableFormatted}</td>
          </tr>
        </table>

        <div style="background: #fff1f2; border-left: 4px solid #e11d48; padding: 12px; margin: 20px 0;">
          <p style="margin: 0; font-size: 13px; color: #9f1239;">
            <strong>Cure Period Notice:</strong> Please clear the outstanding balance on or before <strong>${formattedCureDate}</strong> to prevent waiver forfeiture, account suspension, and formal referral to commercial dispute recovery.
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${payload.paymentLink}" style="background-color: #0f172a; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Settle Total Balance (${penalty.totalPayableFormatted})
          </a>
        </div>

        <p style="font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px;">
          This is an automated legal demand dispatch generated by RevRecover Autonomous Engine on behalf of merchant accounts.
        </p>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from: `"Finance & Recovery Desk" <${process.env.SMTP_USER}>`,
        to: payload.clientEmail,
        subject: `[FINAL DEMAND] Outstanding Settlement Notice - Invoice #${payload.invoiceNumber} (${penalty.totalPayableFormatted})`,
        html: emailHtml,
      });
      return true;
    } catch (err: any) {
      console.error(`Failed to dispatch demand notice to ${payload.clientEmail}:`, err.message);
      return false;
    }
  }
}