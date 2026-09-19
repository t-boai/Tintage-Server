export type SellerRoleType = "individual" | "pro" | "mall";
export interface IAccountUser extends Document {
  fullName: string;
  email: string;
  password?: string;
  phone?: string;
  avatar?: string;
  isActive: boolean;
  isEmailVerified: boolean;
  slug: string;
  refreshToken?: string;
  address?: string[];
  deleted: boolean;
  isVerifiedSeller: boolean;
  sellerRole: SellerRoleType;
  sellerRating: number;
  reviewCount: number;
  createdAt: Date;
  updatedAt: Date;
}
