export const buildCategoryTree = (
  allCategories: any[],
  facetCounts?: { catId: string; count: number }[],
) => {
  const catMap = new Map();

  allCategories.forEach((cat) => {
    catMap.set(cat._id.toString(), {
      id: cat._id.toString(),
      name: cat.name,
      slug: cat.slug,
      image: cat.image || "",
      isFeatured: cat.isFeatured || false,
      parentId: cat.parentId ? cat.parentId.toString() : null,
      count: 0,
      children: [],
    });
  });

  //  Cộng dồn số lượng từ Aggregate Facet
  if (facetCounts && facetCounts.length > 0) {
    facetCounts.forEach((facet) => {
      if (catMap.has(facet.catId)) {
        catMap.get(facet.catId).count += facet.count;
      }
    });

    // Cộng dồn count lên cho các tổ tiên (Ancestors Rollup)
    allCategories.forEach((cat) => {
      const catCount = catMap.get(cat._id.toString()).count;
      // Nhờ mảng ancestors, nếu Level 3 có hàng thì Level 2 tự động được cộng lên
      if (catCount > 0 && cat.ancestors && Array.isArray(cat.ancestors)) {
        cat.ancestors.forEach((anc: any) => {
          const ancId = anc._id.toString();
          if (catMap.has(ancId)) {
            catMap.get(ancId).count += catCount;
          }
        });
      }
    });
  }

  //  thêm cha - con
  const categoryTree: any[] = [];

  allCategories.forEach((cat) => {
    const node = catMap.get(cat._id.toString());

    if (node.parentId) {
      if (node.count === 0) return;

      const parentNode = catMap.get(node.parentId);
      if (parentNode) {
        parentNode.children.push(node);
      } else {
        categoryTree.push(node);
      }
    } else {
      categoryTree.push(node);
    }
  });

  return categoryTree;
};
