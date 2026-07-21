import { InputHTMLAttributes, useState } from 'react';

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string;
};

export function PasswordField({ label, id, className, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const fieldId = id || props.name || label.toLowerCase().replace(/\s+/g, '-');

  return (
    <label htmlFor={fieldId}>
      {label}
      <div className="password-field">
        <input
          {...props}
          id={fieldId}
          className={className}
          type={visible ? 'text' : 'password'}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </label>
  );
}
