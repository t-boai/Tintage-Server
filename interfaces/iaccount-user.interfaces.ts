export interface IAccountUser extends Document {
  fullName: string;
  email: string;
  password?: string;
  phone?: string;
  avatar?: string;
  isActive: boolean;
  isEmailVerified: boolean;
  refreshToken?: string;
  deleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}
