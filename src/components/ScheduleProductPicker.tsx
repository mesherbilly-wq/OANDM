import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ProductModel } from '../types';
import {
  appliedProductFromModel,
  formatScheduleProductLabel,
  listClosestScheduleProducts,
  type AppliedScheduleProduct,
} from '../lib/scheduleProductPick';

const inputClass =
  'w-full min-w-[8rem] border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500';

const formInputClass =
  'w-full border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-slate-900 bg-white text-sm';

interface Props {
  manufacturer: string | null;
  modelNumber: string | null;
  modelName?: string | null;
  deviceType?: string | null;
  products: ProductModel[];
  disabled?: boolean;
  variant?: 'table' | 'form';
  onApply: (next: AppliedScheduleProduct) => void;
}

export function ScheduleProductPicker({
  manufacturer,
  modelNumber,
  modelName,
  deviceType,
  products,
  disabled,
  variant = 'table',
  onApply,
}: Props) {
  const [mfrDraft, setMfrDraft] = useState(manufacturer ?? '');
  const [modelDraft, setModelDraft] = useState(modelNumber ?? '');
  const [openField, setOpenField] = useState<'manufacturer' | 'model' | null>(null);
  const pickedRef = useRef(false);

  useEffect(() => {
    setMfrDraft(manufacturer ?? '');
    setModelDraft(modelNumber ?? '');
  }, [manufacturer, modelNumber]);

  useEffect(() => {
    const hide = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-schedule-product]')) return;
      setOpenField(null);
    };
    document.addEventListener('mousedown', hide);
    return () => document.removeEventListener('mousedown', hide);
  }, []);

  const query = openField === 'manufacturer' ? mfrDraft : openField === 'model' ? modelDraft : '';
  const suggestions = useMemo(
    () => listClosestScheduleProducts(
      {
        manufacturer: mfrDraft || manufacturer,
        modelNumber: modelDraft || modelNumber,
        modelName,
        deviceType,
        query,
      },
      products,
    ),
    [deviceType, manufacturer, mfrDraft, modelDraft, modelName, modelNumber, products, query],
  );

  const commitManual = () => {
    if (pickedRef.current) {
      pickedRef.current = false;
      setOpenField(null);
      return;
    }
    const nextMfr = mfrDraft.trim() || null;
    const nextModel = modelDraft.trim() || null;
    if ((nextMfr ?? '') === (manufacturer ?? '') && (nextModel ?? '') === (modelNumber ?? '')) {
      setOpenField(null);
      return;
    }
    setOpenField(null);
    onApply({
      manufacturer: nextMfr,
      modelNumber: nextModel,
      modelName: modelName?.trim() || null,
      deviceType: deviceType?.trim() || null,
      warrantyYears: null,
      matched: false,
      created: false,
    });
  };

  const pickProduct = (product: ProductModel) => {
    pickedRef.current = true;
    const applied = appliedProductFromModel(product);
    setMfrDraft(applied.manufacturer ?? '');
    setModelDraft(applied.modelNumber ?? '');
    setOpenField(null);
    onApply(applied);
  };

  const field = (
    kind: 'manufacturer' | 'model',
    value: string,
    setValue: (next: string) => void,
    placeholder: string,
  ) => (
    <div className="relative" data-schedule-product>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        className={variant === 'form' ? formInputClass : inputClass}
        onChange={event => {
          setValue(event.target.value);
          setOpenField(kind);
        }}
        onFocus={() => setOpenField(kind)}
        onBlur={() => {
          window.setTimeout(() => {
            if (openField === kind) commitManual();
          }, 120);
        }}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setOpenField(null);
        }}
      />
      {openField === kind && !disabled && suggestions.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Closest Product Database matches
          </p>
          {suggestions.map(product => (
            <button
              key={product.id}
              type="button"
              className="w-full text-left px-2.5 py-1.5 text-xs text-slate-800 hover:bg-cyan-50"
              onMouseDown={event => event.preventDefault()}
              onClick={() => pickProduct(product)}
            >
              {formatScheduleProductLabel(product)}
            </button>
          ))}
          <p className="px-2.5 py-1.5 text-[10px] text-slate-400 border-t border-slate-100">
            Or type a value and leave the box — new items are added to the Product Database.
          </p>
        </div>
      )}
    </div>
  );

  if (variant === 'form') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Manufacturer</label>
          {field('manufacturer', mfrDraft, setMfrDraft, 'Manufacturer')}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Model / Part No.</label>
          {field('model', modelDraft, setModelDraft, 'Model / part number')}
        </div>
      </div>
    );
  }

  return (
    <>
      <td className="px-4 py-3">{field('manufacturer', mfrDraft, setMfrDraft, 'Manufacturer')}</td>
      <td className="px-4 py-3">{field('model', modelDraft, setModelDraft, 'Model')}</td>
    </>
  );
}
