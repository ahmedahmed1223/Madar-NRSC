export interface NewsArchiveFilters {
  station?: string;
  excludedStations?: string[]; // Supplied by the server.
  from?: string;
  to?: string;
}
