export interface ToastMessage {
  id: number;
  text: string;
  tone?: "success" | "error";
}

export function ToastHost({ messages }: { messages: ToastMessage[] }) {
  return (
    <div className="toast-host" aria-live="polite" aria-atomic="true">
      {messages.map((message) => (
        <div className={`toast ${message.tone === "error" ? "toast-error" : ""}`} key={message.id}>
          {message.text}
        </div>
      ))}
    </div>
  );
}
