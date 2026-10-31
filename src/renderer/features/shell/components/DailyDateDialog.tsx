import React, { useState } from "react";
import { validDate } from "@/common/vaultModel";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/renderer/shared/ui";

interface DailyDateDialogProps {
  open: boolean;
  /** The day the field starts at each time the dialog opens. */
  defaultDate: string;
  onOpenChange: (open: boolean) => void;
  /** Gets a valid `YYYY-MM-DD` date once the dialog has closed. */
  onCreate: (date: string) => void;
}

/** The dialog's form, mounted while the dialog is open, so it starts from the default each time. */
function DateForm({ defaultDate, onCancel, onCreate }: { defaultDate: string; onCancel: () => void; onCreate: (date: string) => void }) {
  const [date, setDate] = useState(defaultDate);
  const [invalid, setInvalid] = useState(false);

  return (
    // Chromium blocks the submit of a part-filled date with its own bubble; without its check the date reads empty and gets the message here.
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (validDate(date)) onCreate(date);
        else setInvalid(true);
      }}
    >
      <DialogHeader>
        <DialogTitle>New daily page</DialogTitle>
        <DialogDescription className="sr-only">Choose the day of the page.</DialogDescription>
      </DialogHeader>
      <input
        type="date"
        value={date}
        onChange={(event) => {
          setDate(event.target.value);
          setInvalid(false);
        }}
        aria-label="Date"
        aria-invalid={invalid || undefined}
        className="mt-3 h-control w-full rounded-control border border-border-strong bg-canvas px-2 text-ui tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
      {invalid ? (
        <p role="alert" className="mt-2 text-ui font-medium text-foreground">
          Choose a full date.
        </p>
      ) : null}
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Create</Button>
      </DialogFooter>
    </form>
  );
}

/** Picks the day of a new daily page. Any day works; a day whose page exists opens that page. */
export const DailyDateDialog: React.FC<DailyDateDialogProps> = ({ open, defaultDate, onOpenChange, onCreate }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-testid="daily-date-dialog" className="max-w-xs" showCloseButton={false}>
      <DateForm
        defaultDate={defaultDate}
        onCancel={() => onOpenChange(false)}
        onCreate={(date) => {
          onOpenChange(false);
          onCreate(date);
        }}
      />
    </DialogContent>
  </Dialog>
);
