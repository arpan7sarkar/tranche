"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const OPTIONS = [
  { value: "off", label: "Never, I release each milestone myself" },
  { value: "24", label: "24 hours after every check passes" },
  { value: "72", label: "3 days after every check passes" },
  { value: "168", label: "7 days after every check passes" },
];

export function AutoReleaseForm({ token, current }: { token: string; current: number | null }) {
  const [value, setValue] = useState(current === null ? "off" : String(current));
  const [saving, setSaving] = useState(false);

  async function save(next: string | null) {
    if (next === null || next === value) return;
    const previous = value;
    setValue(next);
    setSaving(true);
    const res = await fetch(`/api/portal/${token}/policy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoReleaseAfterHours: next === "off" ? null : Number(next) }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      toast.success("Auto-release rule saved.");
    } else {
      setValue(previous);
      toast.error("Could not save your auto-release rule. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="auto-release">Release automatically</Label>
      <Select items={OPTIONS} value={value} onValueChange={save} disabled={saving}>
        <SelectTrigger id="auto-release" data-testid="auto-release" className="w-full sm:w-80">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
