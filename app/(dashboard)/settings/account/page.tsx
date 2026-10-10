"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useAuthStore } from "@/stores/auth-store";

const ROLE_LABELS: Record<string, string> = {
  owner: "Pemilik",
  admin: "Administrator",
  staff: "Staf",
};

export default function AccountPage() {
  const user = useAuthStore((state) => state.auth.user);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Akun Saya</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Informasi akun dan peran Anda pada bisnis yang sedang aktif.
        </p>
      </div>
      <Card>
        <CardContent>
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Nama pengguna</dt>
              <dd className="mt-1 break-all font-medium">{user?.accountNo ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Peran</dt>
              <dd className="mt-1 font-medium">
                {user?.role.map((role) => ROLE_LABELS[role] ?? role).join(", ") || "—"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
