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
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded-[2px] border-neutral-400 text-brand focus:ring-brand/30 cursor-pointer accent-brand"
      />
      {label && <span className="text-[12px] text-neutral-800 leading-tight">{label}</span>}
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
  name,
  value,
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
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange()}
        className="w-4 h-4 border-neutral-400 text-brand focus:ring-brand/30 cursor-pointer accent-brand"
      />
      {label && <span className="text-[12px] text-neutral-800 leading-tight">{label}</span>}
    </label>
  );
};


/* 3. WIN32 UNIFIED TEXT INPUT */
export const WinInput = React.forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`h-[26px] px-2 bg-white border border-neutral-400 rounded-[2px] text-[12px] text-neutral-800 focus:bg-white focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none transition-all disabled:bg-neutral-100 disabled:text-neutral-400 disabled:border-neutral-300 ${className}`}
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
        className={`h-[26px] px-2 bg-white border border-neutral-400 rounded-[2px] text-[12px] text-neutral-800 focus:bg-white focus:border-brand outline-none transition-all disabled:bg-neutral-100 disabled:text-neutral-400 disabled:border-neutral-300 cursor-pointer ${className}`}
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
    primary: 'bg-brand hover:bg-brand-hover active:bg-brand-active text-white font-medium shadow-xs border-transparent',
    secondary: 'bg-white hover:bg-neutral-50 active:bg-neutral-200 text-neutral-800 border-neutral-300 shadow-sm',
    danger: 'bg-status-error hover:bg-status-error text-white font-medium shadow-xs border-transparent',
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
  /** Text or a control (e.g. a checkbox — the "Use authorization" group). */
  title: ReactNode;
  children: ReactNode;
  className?: string;
}

export const WinGroupBox: React.FC<WinGroupBoxProps> = ({ title, children, className = '' }) => {
  return (
    <fieldset className={`border border-neutral-300 bg-white p-3 rounded-[3px] shadow-sm ${className}`}>
      <legend className="px-1.5 text-[11px] font-semibold text-brand select-none bg-white">
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
    <div className={`px-1 -mt-2 mb-3 bg-white border-b border-neutral-200 flex flex-wrap gap-x-1 gap-y-0.5 select-none ${className}`}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`px-3 py-1.5 rounded-t-[3px] border-t border-x whitespace-nowrap transition-colors text-[11.5px] font-medium ${
              isActive
                ? 'bg-white border-neutral-300 border-b-white text-brand -mb-[1px] z-10 shadow-sm'
                : 'bg-transparent border-transparent text-neutral-500 hover:text-neutral-900'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};
