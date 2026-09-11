import { Request, Response } from "express";
import mongoose from "mongoose";

// helpers
import { isActuallyNew } from "@/helpers/isActuallyNew.helper";
import { formatJoinedTime } from "@/helpers/formatJoinedTime";
import { buildCategoryTree } from "@/helpers/buildCategoryTree.helper";

// interfaces
import { AccountRequest } from "@/interfaces/request.interfaces";

// models
import Heart from "@/models/hearts.models";
import Product from "@/models/products.models";
import Categories from "@/models/categories.models";

export const productDetail = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const { slugOrId } = req.params;

    const userId = req.account?.id;

    if (!slugOrId || slugOrId === "undefined" || slugOrId === "null") {
      res.status(400).json({
        code: "error",
        message: "Thiếu định danh sản phẩm.",
      });
      return;
    }

    // Tìm theo slug hoặc id
    const isObjectId = mongoose.Types.ObjectId.isValid(`${slugOrId}`);
    const matchQuery: any = {
      deleted: false,
      isActive: true,
      ...(isObjectId
        ? { _id: new mongoose.Types.ObjectId(`${slugOrId}`) }
        : { slug: slugOrId }),
    };

    // Query chi tiết kết hợp populate Category & Seller
    const product = await Product.findOne(matchQuery)
      .populate({
        path: "category",
        select: "_id name slug ancestors",
      })
      .populate({
        path: "seller",
        select:
          "_id fullName slug avatar isVerifiedSeller sellerRole sellerRating createdAt",
      })
      .lean();

    if (!product) {
      res.status(404).json({
        code: "error",
        message: "Sản phẩm không tồn tại hoặc đã ngừng kinh doanh.",
      });
      return;
    }

    // Background Non-blocking: Tăng viewsCount bất đồng bộ
    Product.updateOne({ _id: product._id }, { $inc: { viewsCount: 1 } }).catch(
      (err) => console.error("Lỗi tăng lượt xem: ", err),
    );

    // Check Thả tim
    let isLiked = false;
    if (userId) {
      const heartExist = await Heart.exists({
        user: new mongoose.Types.ObjectId(userId),
        product: product._id,
      });
      isLiked = Boolean(heartExist);
    }

    // Đếm số sản phẩm của Shop
    const sellerId = (product.seller as any)?._id;
    let sellerTotalProducts = 0;
    if (sellerId) {
      sellerTotalProducts = await Product.countDocuments({
        seller: sellerId,
        deleted: false,
        isActive: true,
        stock: { $gt: 0 },
      });
    }

    // categories (breadcrumbs)
    const categoryData = product.category as any;
    let breadcrumbs: any[] = [];

    if (categoryData) {
      // Đưa tổ tiên (nếu có) vào mảng trước
      if (categoryData.ancestors && categoryData.ancestors.length > 0) {
        breadcrumbs = categoryData.ancestors.map((anc: any) => ({
          id: anc._id?.toString(),
          name: anc.name,
          slug: anc.slug,
        }));
      }

      // Đưa danh mục hiện tại vào cuối mảng
      breadcrumbs.push({
        id: categoryData._id?.toString(),
        name: categoryData.name,
        slug: categoryData.slug,
      });
    }

    const productFinal = {
      id: product._id.toString(),
      brand: product.brand,
      name: product.name,
      slug: product.slug,
      price: product.price,
      originalPrice: product.originalPrice || 0,
      discount: product.discount || 0,
      condition: product.condition ? `Độ mới ${product.condition}%` : null,
      size: product.size || null,
      images: product.images || [],
      location: product.location,
      description: product.description || "",
      material: product.material || "",
      stock: product.stock,
      gender: product.gender,
      colors: product.colors,
      viewsCount: (product.viewsCount || 0) + 1,
      likesCount: product.likesCount || 0,
      salesCount: product.salesCount || 0,
      isNew: isActuallyNew(product.isNewProduct, product.createdAt),
      isLiked,
      categories: breadcrumbs.length > 0 ? breadcrumbs : null,
      seller: product.seller
        ? {
            slug: (product.seller as any).slug,
            fullName: (product.seller as any).fullName,
            avatar: (product.seller as any).avatar || "",
            isVerifiedSeller: (product.seller as any).isVerifiedSeller || false,
            sellerRole: (product.seller as any).sellerRole || "individual",
            sellerRating: (product.seller as any).sellerRating || 5.0,
            reviewCount: (product.seller as any).reviewCount || 0,
            totalProducts: sellerTotalProducts,
            joinedAt: (product.seller as any).createdAt,
            joinedTime: formatJoinedTime((product.seller as any).createdAt),
          }
        : null,
      createdTime: formatJoinedTime(product.createdAt),
    };

    res.setHeader(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=120",
    );
    res.status(200).json({
      code: "success",
      message: "Lấy chi tiết sản phẩm thành công",
      data: productFinal,
    });
  } catch (error) {
    console.error("Lỗi sản phẩm chi tiết: ", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};

export const recommendations = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(
      24,
      Math.max(1, parseInt(req.query.limit as string, 10) || 12),
    );
    const skip = (page - 1) * limit;

    const { categoryId, excludeId, sellerId } = req.query;

    let seedNum = 0;
    if (excludeId && mongoose.Types.ObjectId.isValid(`${excludeId}`)) {
      const hex = excludeId.toString().slice(-5);
      seedNum = parseInt(hex, 16) || 0;
    }

    const ROTATION_WINDOW_SECONDS = 120;
    const now = Date.now();
    const timeBucket = Math.floor(now / (ROTATION_WINDOW_SECONDS * 1000));
    const secondsRemaining =
      ROTATION_WINDOW_SECONDS -
      (Math.floor(now / 1000) % ROTATION_WINDOW_SECONDS);

    const matchStage: any = {
      deleted: false,
      isActive: true,
      stock: { $gt: 0 },
    };

    if (categoryId && mongoose.Types.ObjectId.isValid(`${categoryId}`)) {
      matchStage.category = new mongoose.Types.ObjectId(`${categoryId}`);
    }
    if (sellerId && mongoose.Types.ObjectId.isValid(`${sellerId}`)) {
      matchStage.seller = new mongoose.Types.ObjectId(`${sellerId}`);
    }
    if (excludeId && mongoose.Types.ObjectId.isValid(`${excludeId}`)) {
      matchStage._id = { $ne: new mongoose.Types.ObjectId(`${excludeId}`) };
    }

    const result = await Product.aggregate(
      [
        { $match: matchStage },
        {
          $facet: {
            metadata: [{ $count: "total" }],
            data: [
              {
                $addFields: {
                  rotationScore: {
                    $mod: [
                      {
                        $add: [
                          { $toLong: "$createdAt" },
                          timeBucket * 1103515245,
                          seedNum * 99991,
                        ],
                      },
                      1000000,
                    ],
                  },
                },
              },
              { $sort: { rotationScore: -1, createdAt: -1 } },
              { $skip: skip },
              { $limit: limit },
              {
                $lookup: {
                  from: "categories",
                  localField: "category",
                  foreignField: "_id",
                  as: "categoryInfo",
                },
              },
              {
                $unwind: {
                  path: "$categoryInfo",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $lookup: {
                  from: "users",
                  localField: "seller",
                  foreignField: "_id",
                  as: "sellerInfo",
                },
              },
              {
                $unwind: {
                  path: "$sellerInfo",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $project: {
                  _id: 1,
                  brand: 1,
                  name: 1,
                  price: 1,
                  originalPrice: 1,
                  condition: 1,
                  size: 1,
                  material: 1,
                  image: { $arrayElemAt: ["$images", 0] },
                  slug: 1,
                  stock: 1,
                  location: 1,
                  salesCount: 1,
                  likesCount: 1,
                  isNewProduct: 1,
                  createdAt: 1,
                  categoryInfo: { _id: 1, name: 1, slug: 1 },
                  sellerInfo: {
                    _id: 1,
                    slug: 1,
                    fullName: 1,
                    avatar: 1,
                    isVerifiedSeller: 1,
                    sellerRole: 1,
                    sellerRating: 1,
                  },
                },
              },
            ],
          },
        },
      ],
      { allowDiskUse: true },
    );

    const totalItems = result[0]?.metadata[0]?.total || 0;
    const rawProducts = result[0]?.data || [];
    const totalPages = Math.ceil(totalItems / limit);

    const productsFinal = rawProducts.map((item: any) => ({
      id: item._id.toString(),
      brand: item.brand,
      name: item.name,
      price: item.price,
      originalPrice: item.originalPrice || 0,
      discount: item.discount || 0,
      condition: item.condition ? `Độ mới ${item.condition}%` : null,
      size: item.size || null,
      material: item.material || "",
      isNew: isActuallyNew(item.isNewProduct, item.createdAt),
      image: item.image || "",
      slug: item.slug,
      stock: item.stock,
      gender: item.gender,
      colors: item.colors,
      location: item.location,
      salesCount: item.salesCount || 0,
      likesCount: item.likesCount || 0,
      category: item.categoryInfo
        ? {
            id: item.categoryInfo._id.toString(),
            name: item.categoryInfo.name,
            slug: item.categoryInfo.slug,
          }
        : null,
      seller: item.sellerInfo
        ? {
            id: item.sellerInfo._id.toString(),
            slug: item.sellerInfo.slug || null,
            fullName: item.sellerInfo.fullName,
            avatar: item.sellerInfo.avatar || "",
            isVerified: item.sellerInfo.isVerifiedSeller || false,
            role: item.sellerInfo.sellerRole || "individual",
            rating: item.sellerInfo.sellerRating || 5.0,
          }
        : null,
    }));

    res.setHeader(
      "Cache-Control",
      `public, max-age=${Math.max(secondsRemaining, 5)}`,
    );

    res.status(200).json({
      code: "success",
      message: "Lấy gợi ý sản phẩm thành công",
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
      },
      data: productsFinal,
    });
  } catch (error) {
    console.error("Lỗi lấy gợi ý sản phẩm:", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};

let cachedCategories: any[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

const getCachedCategories = async () => {
  const now = Date.now();
  if (!cachedCategories || now - lastCacheTime > CACHE_TTL) {
    cachedCategories = await Categories.find({
      deleted: false,
      isActive: true,
    }).lean();
    lastCacheTime = now;
    console.log("Đã tải lại danh mục lên RAM!");
  }
  return cachedCategories;
};

export const searchProducts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(
      48,
      Math.max(1, parseInt(req.query.limit as string, 10) || 16),
    );
    const skip = (page - 1) * limit;

    const {
      keyword,
      category,
      brands,
      colors,
      sizes,
      genders,
      condition,
      minPrice,
      maxPrice,
      sort,
      location,
      getFilters,
    } = req.query;

    const isGetFilters = getFilters === "true";
    const isBroadSearch =
      !keyword &&
      !category &&
      !brands &&
      !colors &&
      !sizes &&
      !genders &&
      !condition &&
      !minPrice &&
      !maxPrice &&
      !location;

    // Lấy danh mục từ ram
    const allCategories = await getCachedCategories();

    const baseMatchStage: any = {
      deleted: false,
      isActive: true,
      stock: { $gt: 0 },
    };
    if (keyword && typeof keyword === "string" && keyword.trim() !== "") {
      const formattedKeyword = keyword
        .trim()
        .split(/\s+/)
        .map((word) => `"${word}"`)
        .join(" ");
      baseMatchStage.$text = { $search: formattedKeyword };
    }

    // Category Filter (Xử lý trên RAM)
    const categoryMatchStage: any = {};
    if (category && typeof category === "string") {
      const isObjectId = mongoose.Types.ObjectId.isValid(category);

      // Tìm cat trực tiếp trong mảng RAM
      const foundCat = allCategories.find((c: any) =>
        isObjectId ? c._id.toString() === category : c.slug === category,
      );

      if (foundCat) {
        // Tìm con cháu trực tiếp trong RAM
        const descendantCats = allCategories.filter(
          (c: any) =>
            c.ancestors &&
            c.ancestors.some(
              (anc: any) => anc._id.toString() === foundCat._id.toString(),
            ),
        );
        const allCatIds = [
          foundCat._id,
          ...descendantCats.map((c: any) => c._id),
        ];
        categoryMatchStage.category = { $in: allCatIds };
      } else {
        categoryMatchStage.category = null;
      }
    }

    // Deep Filters
    const deepFilterMatchStage: any = {};
    if (brands && typeof brands === "string")
      deepFilterMatchStage.brand = {
        $in: brands.split(",").map((b) => b.trim()),
      };
    if (colors && typeof colors === "string") {
      const colorArray = colors.split(",").map((c) => c.trim().toLowerCase());
      if (colorArray.includes("gray") && !colorArray.includes("grey"))
        colorArray.push("grey");
      else if (colorArray.includes("grey") && !colorArray.includes("gray"))
        colorArray.push("gray");
      deepFilterMatchStage.colors = { $in: colorArray };
    }
    if (sizes && typeof sizes === "string")
      deepFilterMatchStage.size = {
        $in: sizes.split(",").map((s) => s.trim()),
      };
    if (genders && typeof genders === "string") {
      const selectedGenders = genders
        .split(",")
        .map((g) => g.trim().toLowerCase());
      if (!selectedGenders.includes("unisex")) selectedGenders.push("unisex");
      deepFilterMatchStage.gender = { $in: selectedGenders };
    }
    if (condition)
      deepFilterMatchStage.condition = {
        $gte: parseInt(condition as string, 10) || 0,
      };
    if (location && typeof location === "string")
      deepFilterMatchStage.location = location.trim();
    if (minPrice || maxPrice) {
      deepFilterMatchStage.price = {};
      if (minPrice)
        deepFilterMatchStage.price.$gte = parseInt(minPrice as string, 10);
      if (maxPrice)
        deepFilterMatchStage.price.$lte = parseInt(maxPrice as string, 10);
    }

    // Sắp xếp
    let sortStage: any = { isFeatured: -1, createdAt: -1 };
    if (sort) {
      switch (sort) {
        case "price_asc":
          sortStage = { price: 1, createdAt: -1 };
          break;
        case "price_desc":
          sortStage = { price: -1, createdAt: -1 };
          break;
        case "top_sales":
          sortStage = { salesCount: -1, createdAt: -1 };
          break;
        case "discount_desc":
          sortStage = { discount: -1, createdAt: -1 };
          break;
        case "newest":
          sortStage = { createdAt: -1 };
          break;
        case "relevance":
          sortStage = baseMatchStage.$text
            ? { score: { $meta: "textScore" } }
            : { createdAt: -1 };
          break;
      }
    } else if (baseMatchStage.$text)
      sortStage = { score: { $meta: "textScore" } };

    const fullMatchStage = {
      ...baseMatchStage,
      ...categoryMatchStage,
      ...deepFilterMatchStage,
    };

    //  Đếm tổng số
    const countPromise = Product.countDocuments(fullMatchStage);

    // Lấy dữ liệu Sản phẩm
    const productPipeline: any[] = [{ $match: fullMatchStage }];
    if (baseMatchStage.$text)
      productPipeline.push(
        { $addFields: { score: { $meta: "textScore" } } },
        { $match: { score: { $gt: 0.5 } } },
      );
    productPipeline.push(
      { $sort: sortStage },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: "users",
          localField: "seller",
          foreignField: "_id",
          as: "sellerInfo",
        },
      },
      { $unwind: { path: "$sellerInfo", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          brand: 1,
          name: 1,
          price: 1,
          originalPrice: 1,
          discount: 1,
          condition: 1,
          size: 1,
          material: 1,
          colors: 1,
          gender: 1,
          image: { $arrayElemAt: ["$images", 0] },
          slug: 1,
          location: 1,
          salesCount: 1,
          likesCount: 1,
          isNewProduct: 1,
          createdAt: 1,
          category: 1,
          sellerInfo: {
            _id: 1,
            slug: 1,
            fullName: 1,
            avatar: 1,
            isVerifiedSeller: 1,
          },
        },
      },
    );
    const productPromise = Product.aggregate(productPipeline);

    // Facet Brands
    let brandPromise = Promise.resolve([]);
    let categoryFacetPromise = Promise.resolve([]);

    if (isGetFilters) {
      const brandPipeline: any[] = [
        { $match: { ...baseMatchStage, ...categoryMatchStage } },
      ];
      if (baseMatchStage.$text)
        brandPipeline.push(
          { $addFields: { score: { $meta: "textScore" } } },
          { $match: { score: { $gt: 0.5 } } },
        );
      brandPipeline.push(
        { $group: { _id: "$brand", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 15 },
      );
      brandPromise = Product.aggregate(brandPipeline);

      // Facet Categories
      const catFacetPipeline: any[] = [{ $match: baseMatchStage }];
      if (baseMatchStage.$text)
        catFacetPipeline.push(
          { $addFields: { score: { $meta: "textScore" } } },
          { $match: { score: { $gt: 0.5 } } },
        );
      catFacetPipeline.push({
        $group: { _id: "$category", count: { $sum: 1 } },
      });
      categoryFacetPromise = Product.aggregate(catFacetPipeline);
    }
    const [totalItems, rawProducts, rawBrands, rawFacetCats] =
      await Promise.all([
        countPromise,
        productPromise,
        brandPromise,
        categoryFacetPromise,
      ]);

    // format và tự động map id -> tên bằng từ điển ram
    const totalPages = Math.ceil(totalItems / limit);
    const catDict = new Map(allCategories.map((c) => [c._id.toString(), c]));

    const productsFinal = rawProducts.map((item: any) => {
      const catObj = catDict.get(item.category?.toString());
      return {
        id: item._id.toString(),
        brand: item.brand,
        name: item.name,
        price: item.price,
        originalPrice: item.originalPrice || 0,
        discountPercent: item.discount || 0,
        condition: item.condition ? `Độ mới ${item.condition}%` : null,
        size: item.size || null,
        material: item.material || "",
        colors: item.colors || [],
        gender: item.gender || "unisex",
        isNew: isActuallyNew(item.isNewProduct, item.createdAt),
        image: item.image || "",
        slug: item.slug,
        location: item.location,
        salesCount: item.salesCount || 0,
        likesCount: item.likesCount || 0,
        categoryInfo: catObj
          ? { _id: catObj._id, name: catObj.name, slug: catObj.slug }
          : null,
        seller: item.sellerInfo
          ? { ...item.sellerInfo, id: item.sellerInfo._id.toString() }
          : null,
      };
    });

    let sidebarFilters = null;
    if (isGetFilters) {
      const facetCounts = rawFacetCats.map((facet: any) => ({
        catId: facet._id?.toString(),
        count: facet.count,
      }));
      const categoryTree = buildCategoryTree(allCategories, facetCounts);
      const formattedBrands = rawBrands.map((b: any) => ({
        name: b._id,
        count: b.count,
      }));
      sidebarFilters = { brands: formattedBrands, categories: categoryTree };
    }

    if (isBroadSearch && page === 1)
      res.setHeader(
        "Cache-Control",
        "public, max-age=300, stale-while-revalidate=120",
      );
    else res.setHeader("Cache-Control", "no-store");

    res.status(200).json({
      code: "success",
      message: "Tìm kiếm thành công",
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
      },
      filtersInfo: sidebarFilters,
      data: productsFinal,
    });
  } catch (error) {
    console.error("Lỗi Api tìm kiếm:", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};
