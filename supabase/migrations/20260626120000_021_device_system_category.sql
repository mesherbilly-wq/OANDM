-- Trade category for icons, filtering and reporting (not project hierarchy).
-- System names live in devices.system_type (one row per device; systems are derived from distinct values).
ALTER TABLE devices ADD COLUMN IF NOT EXISTS system_category text;

COMMENT ON COLUMN devices.system_category IS
  'Trade category (Security, Fire, Electrical, etc.). NULL = infer from system_type for legacy rows.';
