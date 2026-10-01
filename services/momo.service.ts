import crypto, { randomUUID } from "node:crypto";
import axios from "axios";

interface CreateMomoPaymentParams {
  orderCode: string;
  amount: number;
  orderInfo: string;
}

export const createMomoPaymentUrl = async ({
  orderCode,
  amount,
  orderInfo,
}: CreateMomoPaymentParams): Promise<string> => {
  const partnerCode = process.env.MOMO_PARTNER_CODE!;
  const accessKey = process.env.MOMO_ACCESS_KEY!;
  const secretKey = process.env.MOMO_SECRET_KEY!;
  const endpoint = process.env.MOMO_ENDPOINT!;
  const redirectUrl = `${process.env.NEXT_PUBLIC_FE_URL}/thank-you?orderCode=${orderCode}`;
  const ipnUrl = process.env.MOMO_IPN_URL!;
  const requestType = "payWithMethod";
  const requestId = `${orderCode}_${Date.now()}`;
  const extraData = "";

  const rawSignature = `accessKey=${accessKey}&amount=${amount}&extraData=${extraData}&ipnUrl=${ipnUrl}&orderId=${orderCode}&orderInfo=${orderInfo}&partnerCode=${partnerCode}&redirectUrl=${redirectUrl}&requestId=${requestId}&requestType=${requestType}`;
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(rawSignature)
    .digest("hex");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      partnerCode,
      accessKey,
      requestId,
      amount,
      orderId: orderCode,
      orderInfo,
      redirectUrl,
      ipnUrl,
      extraData,
      requestType,
      signature,
      lang: "vi",
    }),
  });

  const data = await response.json();
  if (data.resultCode !== 0 || !data.payUrl)
    throw new Error(`[MOMO_INIT_FAILED]: ${data.message}`);
  return data.payUrl;
};

export const checkMomoOrderStatus = async (orderId: string) => {
  const partnerCode = process.env.MOMO_PARTNER_CODE!;
  const accessKey = process.env.MOMO_ACCESS_KEY!;
  const secretKey = process.env.MOMO_SECRET_KEY!;
  const requestId = randomUUID();
  const rawSignature = `accessKey=${accessKey}&orderId=${orderId}&partnerCode=${partnerCode}&requestId=${requestId}`;
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(rawSignature)
    .digest("hex");

  const response = await axios.post(
    "https://test-payment.momo.vn/v2/gateway/api/query",
    {
      partnerCode,
      requestId,
      orderId,
      signature,
      lang: "vi",
    },
  );
  return response.data;
};

export const refundMomoPayment = async ({
  orderId,
  orderCode,
  amount,
  transId,
  description = "Hoàn tiền tự động",
}: any) => {
  const partnerCode = process.env.MOMO_PARTNER_CODE!;
  const accessKey = process.env.MOMO_ACCESS_KEY!;
  const secretKey = process.env.MOMO_SECRET_KEY!;
  const refundReqId = `REFUND_${orderCode}`;
  const rawSignature = `accessKey=${accessKey}&amount=${amount}&description=${description}&orderId=${orderId}&partnerCode=${partnerCode}&requestId=${refundReqId}&transId=${transId}`;
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(rawSignature)
    .digest("hex");

  try {
    const response = await axios.post(
      "https://test-payment.momo.vn/v2/gateway/api/refund",
      {
        partnerCode,
        orderId,
        requestId: refundReqId,
        amount,
        transId,
        lang: "vi",
        description,
        signature,
      },
    );
    if (response.data.resultCode !== 0)
      throw new Error(`MoMo từ chối Refund: ${response.data.message}`);
    return response.data;
  } catch (error: any) {
    console.error(`Critical Auto Refund thất bại cho đơn: ${orderCode}!`);
    throw error;
  }
};
