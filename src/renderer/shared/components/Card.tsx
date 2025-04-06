import * as React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "primary";
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(({
  children,
  className,
  variant = "default",
  ...props
}, ref) => {
  const baseClasses = "rounded-2xl p-4 transition-shadow duration-200";
  const variantClasses =
    variant === "primary"
      ? "bg-gradient-primary text-primary-foreground"
      : "bg-secondary text-secondary-foreground";

  return (
    <div
      ref={ref}
      className={`${baseClasses} ${variantClasses} hover:shadow-md ${
        className || ""
      }`}
      {...props}
    >
      {children}
    </div>
  );
});
