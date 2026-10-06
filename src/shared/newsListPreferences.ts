export const NEWS_COLUMNS = ['category', 'priority', 'author', 'updatedAt'] as const;
export type NewsColumn = typeof NEWS_COLUMNS[number];
export interface NewsListPreferences { pageSize: number; columns: NewsColumn[] }
export function sanitizeNewsListPreferences(raw: any): NewsListPreferences {
  return {
    pageSize: [10, 25, 50, 100].includes(raw?.pageSize) ? raw.pageSize : 50,
    columns: Array.isArray(raw?.columns) ? [...new Set<NewsColumn>(raw.columns.filter((key: any) => NEWS_COLUMNS.includes(key)))] : [...NEWS_COLUMNS],
  };
}
