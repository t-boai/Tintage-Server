import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: process.env.EMAIL_SECURE === "true",
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD,
  },
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
});

transporter.verify((error) => {
  if (error) {
    console.error("[Nodemailer] Lỗi kết nối SMTP:", error);
  } else {
    console.log("[Nodemailer] Đã sẵn sàng gửi email.");
  }
});

const baseEmailTemplate = (title: string, bodyContent: string) => `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F3F4F6; margin: 0; padding: 40px 20px;">
  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
    
    <!-- HEADER -->
    <tr>
      <td align="center" style="padding: 32px 20px; border-bottom: 1px solid #F3F4F6;">
        <h1 style="margin: 0; font-size: 28px; font-weight: 800; letter-spacing: 3px; color: #E11D48; text-transform: uppercase;">
          TINTAGE
        </h1>
        <p style="margin: 6px 0 0 0; font-size: 12px; font-weight: 600; color: #6B7280; letter-spacing: 1px; text-transform: uppercase;">
          Thời Trang Bền Vững
        </p>
      </td>
    </tr>

    <!-- BODY -->
    <tr>
      <td style="padding: 40px 32px; color: #374151; font-size: 15px; line-height: 1.6;">
        ${bodyContent}
      </td>
    </tr>

    <!-- FOOTER -->
    <tr>
      <td align="center" style="background-color: #F9FAFB; padding: 24px 32px; color: #9CA3AF; font-size: 13px; border-top: 1px solid #F3F4F6;">
        <p style="margin: 0 0 8px 0;">Cảm ơn bạn đã lựa chọn mua sắm và sống xanh cùng <strong>Tintage</strong>.</p>
        <p style="margin: 0 0 8px 0;">Đây là email tự động, vui lòng không trả lời trực tiếp email này.</p>
        <p style="margin: 0;">&copy; ${new Date().getFullYear()} Tintage Vietnam. All rights reserved.</p>
      </td>
    </tr>

  </table>
</body>
</html>
`;

export const getOtpEmailHtml = (otp: string, description: string) => {
  const bodyContent = `
    <p style="margin: 0 0 16px 0; font-size: 18px; font-weight: 700; color: #111827;">Xin chào,</p>
    <p style="margin: 0 0 24px 0; color: #4B5563;">${description}</p>
    
    <!-- OTP BOX (Tone Hồng Đỏ của Tintage) -->
    <div style="background-color: #FFF1F2; border: 1px solid #FDA4AF; border-radius: 12px; padding: 24px; text-align: center; margin: 32px 0;">
      <span style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 800; letter-spacing: 12px; color: #E11D48; display: inline-block; margin-left: 12px;">
        ${otp}
      </span>
    </div>

    <p style="margin: 0 0 12px 0; font-size: 14px; color: #6B7280;">
      ⏱️ Mã xác thực này có hiệu lực trong vòng <strong style="color: #111827;">5 phút</strong>.
    </p>
    <div style="background-color: #FEF2F2; border-left: 4px solid #EF4444; padding: 12px 16px; margin-top: 20px; border-radius: 0 8px 8px 0;">
      <p style="margin: 0; font-size: 13px; color: #991B1B; font-weight: 500; line-height: 1.5;">
        ⚠️ <strong>Bảo mật:</strong> Tuyệt đối không chia sẻ mã này cho bất kỳ ai (kể cả nhân viên CSKH Tintage) để tránh bị chiếm đoạt tài khoản.
      </p>
    </div>
  `;
  return baseEmailTemplate("Mã Xác Thực OTP - Tintage", bodyContent);
};

export const sendMail = async (
  email: string,
  subject: string,
  htmlContent: string,
): Promise<boolean> => {
  try {
    const mailOptions = {
      from: `"Tintage Support" <${process.env.EMAIL_USERNAME}>`,
      to: email,
      subject: subject,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Mail Sent] Tới: ${email} | ID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error(`[Mail Error] Lỗi gửi tới ${email}:`, error);
    return false;
  }
};
