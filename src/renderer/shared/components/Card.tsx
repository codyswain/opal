import React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "primary";
}

export const Card: React.FC<CardProps> = ({
  children,
  className,
  variant = "default",
  ...props
}) => {
  const baseClasses = "rounded-2xl p-4 transition-shadow duration-200";
  const variantClasses =
    variant === "primary"
      ? "bg-gradient-primary text-primary-foreground"
      : "bg-secondary text-secondary-foreground";

  return (
    <div
      className={`${baseClasses} ${variantClasses} hover:shadow-md ${
        className || ""
      }`}
      {...props}
    >
      {children}
    </div>
  );
};
