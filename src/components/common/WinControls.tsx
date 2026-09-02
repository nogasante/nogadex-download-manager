import React, { InputHTMLAttributes, SelectHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

/* 1. WIN32 UNIFIED CHECKBOX */
interface WinCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export const WinCheckbox: React.FC<WinCheckboxProps> = ({
  checked,
  onChange,
  label,
  disabled = false,
  className = '',
}) => {
  return (
    <label
      className={`inline-flex items-center gap-2 select-none ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
    >
      <div
        onClick={(e) => {
          if (!disabled) {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        className={`w-4 h-4 rounded-[2px] transition-all flex items-center justify-center shrink-0 text-[10px] font-bold ${
          checked
            ? 'ndm-checkbox-3d-checked text-white'
            : 'ndm-checkbox-3d-unchecked hover:border-[#005a9e]'
        }`}
      >
        {checked && '✔'}
      </div>
      {label && <span className="text-[12px] text-[#1e293b] leading-tight">{label}</span>}
    </label>
  );
};

/* 2. WIN32 UNIFIED RADIO BUTTON */
interface WinRadioProps {
  checked: boolean;
  onChange: () => void;
  name?: string;
  value?: string;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export const WinRadio: React.FC<WinRadioProps> = ({
  checked,
  onChange,
  label,
  disabled = false,
  className = '',
}) => {
  return (
    <label
      className={`inline-flex items-center gap-2 select-none ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
    >
      <div
        onClick={(e) => {
          if (!disabled) {
            e.preventDefault();
            onChange();
          }
        }}
        className={`w-4 h-4 rounded-full border transition-all flex items-center justify-center shrink-0 ${
          checked
            ? 'border-[#005a9e] bg-[#005a9e] shadow-inner'
            : 'border-[#94a3b8] bg-[#ffffff] hover:border-[#005a9e]'
        }`}
      >
        {checked && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
      </div>
      {label && <span className="text-[12px] text-[#1e293b] leading-tight">{label}</span>}
    </label>
  );
};

/* 3. WIN32 UNIFIED TEXT INPUT */
export const WinInput = React.forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`h-[26px] px-2 bg-white border border-[#94a3b8] rounded-[2px] text-[12px] text-[#1e293b] focus:border-[#005a9e] focus:ring-1 focus:ring-[#005a9e]/30 outline-none transition-all disabled:bg-[#f1f5f9] disabled:text-[#94a3b8] disabled:border-[#cbd5e1] ${className}`}
        {...props}
      />
    );
  }
);
WinInput.displayName = 'WinInput';

/* 4. WIN32 UNIFIED SELECT DROPDOWN */
export const WinSelect = React.forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = '', children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={`h-[26px] px-2 bg-white border border-[#94a3b8] rounded-[2px] text-[12px] text-[#1e293b] focus:border-[#005a9e] outline-none transition-all disabled:bg-[#f1f5f9] disabled:text-[#94a3b8] disabled:border-[#cbd5e1] cursor-pointer ${className}`}
        {...props}
      >
        {children}
      </select>
    );
  }
);
WinSelect.displayName = 'WinSelect';

/* 5. WIN32 UNIFIED BUTTON */
interface WinButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
}

export const WinButton: React.FC<WinButtonProps> = ({
  variant = 'secondary',
  className = '',
  children,
  ...props
}) => {
  const variantStyles = {
    primary: 'bg-[#005a9e] hover:bg-[#1070ca] active:bg-[#004578] text-white font-medium shadow-xs border-transparent',
    secondary: 'bg-[#f8fafc] hover:bg-[#e2e8f0] active:bg-[#cbd5e1] text-[#1e293b] border-[#cbd5e1]',
    danger: 'bg-[#dc2626] hover:bg-[#ef4444] text-white font-medium shadow-xs border-transparent',
  }[variant];

  return (
    <button
      type="button"
      className={`min-w-[80px] h-[26px] px-3 border rounded-[2px] text-[12px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none ${variantStyles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

/* 6. WIN32 UNIFIED GROUPBOX */
interface WinGroupBoxProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export const WinGroupBox: React.FC<WinGroupBoxProps> = ({ title, children, className = '' }) => {
  return (
    <fieldset className={`border border-[#cbd5e1] p-3 rounded-[3px] ${className}`}>
      <legend className="px-1.5 text-[11px] font-semibold text-[#005a9e] select-none">
        {title}
      </legend>
      {children}
    </fieldset>
  );
};

/* 7. WIN32 UNIFIED TAB STRIP */
export interface TabItem {
  id: string;
  label: string;
}

interface WinTabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
}

export const WinTabs: React.FC<WinTabsProps> = ({ tabs, activeTab, onChange, className = '' }) => {
  return (
    <div className={`px-1 -mt-2 mb-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex gap-1 select-none ${className}`}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`px-3 py-1.5 rounded-t-[3px] border-t border-x transition-colors text-[11.5px] font-medium ${
              isActive
                ? 'bg-[#ffffff] border-[#cbd5e1] border-b-transparent text-[#005a9e] -mb-[1px] z-10 shadow-xs'
                : 'bg-transparent border-transparent text-[#64748b] hover:text-[#0f172a]'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};
