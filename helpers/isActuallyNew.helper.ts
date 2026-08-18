export const isActuallyNew = (isNewProduct: boolean, createdAt: Date) => {
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  const nowTime = Date.now();

  const res =
    Boolean(isNewProduct) &&
    Boolean(createdAt) &&
    nowTime - new Date(createdAt).getTime() <= threeDays;

  return res;
};
