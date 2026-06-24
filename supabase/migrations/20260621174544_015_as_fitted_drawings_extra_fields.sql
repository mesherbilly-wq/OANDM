ALTER TABLE as_fitted_drawings
  ADD COLUMN IF NOT EXISTS drawing_type text,
  ADD COLUMN IF NOT EXISTS notes text;
