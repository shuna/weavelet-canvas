import React from 'react';
import Select, { GroupBase, StylesConfig } from 'react-select';

type SelectOption<T extends string> = {
  value: T;
  label: string;
};

const createSelectStyles = <T extends string>(): StylesConfig<
  SelectOption<T>,
  false,
  GroupBase<SelectOption<T>>
> => ({
  control: (provided) => ({
    ...provided,
    backgroundColor: '#2D3748',
    color: '#E2E8F0',
  }),
  menu: (provided) => ({
    ...provided,
    backgroundColor: '#2D3748',
  }),
  option: (provided, state) => ({
    ...provided,
    backgroundColor: state.isSelected ? '#4A5568' : '#2D3748',
    color: '#E2E8F0',
    '&:hover': {
      backgroundColor: '#4A5568',
    },
  }),
  singleValue: (provided) => ({
    ...provided,
    color: '#E2E8F0',
  }),
  input: (provided) => ({
    ...provided,
    color: '#E2E8F0',
  }),
  placeholder: (provided) => ({
    ...provided,
    color: '#A0AEC0',
  }),
});

export const ConfigSection = ({
  children,
  className = 'mt-5 pt-5 border-t border-gray-500',
}: {
  children: React.ReactNode;
  className?: string;
}) => <div className={className}>{children}</div>;

export const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <label className='block text-sm font-medium text-gray-900 dark:text-white'>
    {children}
  </label>
);

export const FieldDescription = ({ children }: { children: React.ReactNode }) => (
  <div className='min-w-fit text-gray-500 dark:text-gray-300 text-sm mt-2'>
    {children}
  </div>
);

export const RangeField = ({
  label,
  value,
  onChange,
  min,
  max,
  step,
  description,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  description: React.ReactNode;
}) => (
  <ConfigSection>
    <FieldLabel>{label}: {value}</FieldLabel>
    <input
      type='range'
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      min={min}
      max={max}
      step={step}
      className='w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer'
    />
    <FieldDescription>{description}</FieldDescription>
  </ConfigSection>
);

export const DarkSelectField = <T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  isClearable = false,
  className = 'mt-5 pt-5 border-t border-gray-500',
}: {
  label: string;
  value: T | null;
  options: SelectOption<T>[];
  onChange: (value: T | null) => void;
  placeholder?: string;
  isClearable?: boolean;
  className?: string;
}) => (
  <ConfigSection className={className}>
    <FieldLabel>{label}</FieldLabel>
    <Select<SelectOption<T>, false>
      value={options.find((option) => option.value === value) ?? null}
      onChange={(selectedOption) => onChange(selectedOption?.value ?? null)}
      options={options}
      placeholder={placeholder}
      isClearable={isClearable}
      className='basic-single'
      classNamePrefix='select'
      styles={createSelectStyles<T>()}
    />
  </ConfigSection>
);
