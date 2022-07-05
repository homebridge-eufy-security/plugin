export type Accessory = {
  uniqueId: string;
  displayName: string;
  type: number;
  station: boolean;
  ignored?: boolean;
  cachedName?: string;
};
