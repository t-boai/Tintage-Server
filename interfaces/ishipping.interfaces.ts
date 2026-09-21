export interface ShippingOptionInfo {
  id: "STANDARD" | "EXPRESS";
  name: string;
  desc: string;
  originalPrice: number;
  discount: number;
  finalPrice: number;
}
