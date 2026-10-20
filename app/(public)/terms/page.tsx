import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | MAXIUS",
  description:
    "Terms for using the MAXIUS multi-store stock and order management service, including service scope, responsibilities, and governing law.",
};

// TODO: Konfirmasi nama bisnis sesuai NIB dan email resmi sebelum submit review.
const BUSINESS_NAME = "Maxius Indonesia";
const CONTACT_EMAIL = "support@maxius.id";

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 text-xl font-bold">{children}</h2>;
}

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 pb-16">
      <h1 className="text-3xl font-bold">Terms of Service</h1>
      <p className="mt-4 text-muted-foreground text-sm">
        These terms govern the use of the MAXIUS service ({BUSINESS_NAME}).
      </p>

      <H2>Service scope</H2>
      <p className="mt-3 text-muted-foreground">
        MAXIUS is a management service for marketplace sellers. It connects your marketplace stores through their official APIs and provides: a central product catalog, product mapping across stores, one central stock with automatic sync, order sync into one dashboard, and stock history with stock opname. MAXIUS is a separate service and is not affiliated with any marketplace platform. Marketplace names and trademarks belong to their respective owners.
      </p>

      <H2>Your account and stores</H2>
      <ul className="mt-3 text-muted-foreground list-disc pl-5 space-y-1 text-sm">
        <li>You are responsible for the accounts you create in MAXIUS and for keeping your credentials safe.</li>
        <li>You are responsible for the stores you connect and for the content of the data synced from them.</li>
        <li>You confirm you have the right to authorize MAXIUS to access those stores.</li>
        <li>You must use the service in line with the marketplace platforms&apos; own rules.</li>
      </ul>

      <H2>Limitation of liability</H2>
      <p className="mt-3 text-muted-foreground">
        The service is provided as is. Synchronization depends on the availability and behavior of the connected marketplace APIs, and we cannot guarantee uninterrupted or error-free sync. To the maximum extent permitted by law, we are not liable for indirect damages, including lost sales, lost profits, penalties, or refund claims caused by platform-side issues or by incorrect data in your connected stores.
      </p>

      <H2>Termination</H2>
      <p className="mt-3 text-muted-foreground">
        You may stop using the service at any time and disconnect your stores. We may suspend or terminate access if the service is misused, if the terms are violated, or if the connected stores or platforms pose a security or compliance risk. On termination, your store connections and stored authorization tokens stop working.
      </p>

      <H2>Governing law</H2>
      <p className="mt-3 text-muted-foreground">
        These terms are governed by the laws of the Republic of Indonesia.
      </p>

      <H2>Contact</H2>
      <p className="mt-3 text-muted-foreground">
        For questions about these terms, email us at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-foreground hover:underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </div>
  );
}
