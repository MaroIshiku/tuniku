import { Children, cloneElement, createContext, isValidElement, useContext, useId, type ReactNode, type ReactElement } from "react";
export const FieldErrors = createContext<Record<string, string>>({});
export function ErrorField(props: { field: string; className?: string; children: ReactNode }) {
  const errors = useContext(FieldErrors);
  const error = errors[props.field];
  const id = useId();
  const children = Children.toArray(props.children);
  const labelIndex = children.findIndex((child) => isValidElement(child) && child.type === "span");
  const label = children[labelIndex] as ReactElement<Record<string, unknown>> | undefined;
  const labelId = String(label?.props.id ?? `${id}-label`);
  const hints = children.flatMap((child, index) => isValidElement(child) && child.type === "small" ? [String((child.props as Record<string, unknown>).id ?? `${id}-hint-${index}`)] : []);
  return <label className={props.className}>{children.map((child, index) => {
    if (!isValidElement(child)) return child;
    const element = child as ReactElement<Record<string, unknown>>;
    if (index === labelIndex) return cloneElement(element, { id: labelId });
    if (child.type === "small") return cloneElement(element, { id: element.props.id ?? `${id}-hint-${index}` });
    if (!["input", "select", "textarea"].includes(String(child.type))) return child;
    const describedBy = [element.props["aria-describedby"], ...hints, error ? id : undefined].filter(Boolean).join(" ") || undefined;
    return cloneElement(element, { "aria-labelledby": element.props["aria-labelledby"] ?? (label ? labelId : undefined), name: props.field,
      "aria-invalid": error ? true : undefined, "aria-describedby": describedBy });
  })}{error && <small id={id} className="field-error">{error} Correct this field and try again.</small>}</label>;
}
