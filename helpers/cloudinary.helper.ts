import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export const generateUploadSignature = (folder: string, tags?: string[]) => {
  const timestamp = Math.round(new Date().getTime() / 1000);

  const paramsToSign: Record<string, any> = {
    timestamp,
    folder,
  };

  if (tags && tags.length > 0) {
    paramsToSign.tags = tags.join(",");
  }

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    process.env.CLOUDINARY_API_SECRET as string,
  );

  return {
    signature,
    timestamp,
    cloudName: process.env.CLOUDINARY_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    folder,
    transformation: "q_auto,f_auto",
    tags: tags ? tags.join(",") : undefined,
  };
};

export const deleteCloudinaryImage = async (
  publicId: string,
): Promise<boolean> => {
  try {
    if (!publicId) return false;
    const result = await cloudinary.uploader.destroy(publicId);
    return result.result === "ok";
  } catch (error) {
    console.error(`Cloudinary Lỗi xóa ảnh ${publicId}:`, error);
    return false;
  }
};
