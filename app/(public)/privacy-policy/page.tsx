import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | MAXIUS",
  description:
    "How MAXIUS accesses, uses, stores, and protects marketplace seller data, including OAuth authorization tokens.",
};

// TODO: Konfirmasi nama bisnis sesuai NIB dan email resmi sebelum submit review.
const BUSINESS_NAME = "Maxius Indonesia";
const CONTACT_EMAIL = "support@maxius.id";

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 text-xl font-bold">{children}</h2>;
}

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 pb-16">
      <h1 className="text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-4 text-muted-foreground text-sm">
        This policy explains how MAXIUS ({BUSINESS_NAME}) handles seller data when you connect your marketplace stores to the service.
      </p>

      <H2>Data we access</H2>
      <p className="mt-3 text-muted-foreground">
        When you authorize a store through the official marketplace OAuth flow, MAXIUS accesses only the API permissions needed to run the product:
      </p>
      <ul className="mt-3 text-muted-foreground list-disc pl-5 space-y-1 text-sm">
        <li>Store information: shop name, shop identifier, and authorization status.</li>
        <li>Product data: product and variant information used for the central catalog and product mapping.</li>
        <li>Stock data: stock levels needed to sync one central stock to each connected store.</li>
        <li>Order data: order and shipment status synced from connected stores into one dashboard.</li>
      </ul>

      <H2>How we use the data</H2>
      <p className="mt-3 text-muted-foreground">
        Seller data is used to run the features of the service: keeping the product catalog, mapping products across stores, syncing stock, and collecting orders. We do not use seller data for advertising, and we do not sell it.
      </p>

      <H2>Authorization tokens</H2>
      <p className="mt-3 text-muted-foreground">
        Store authorizations are issued through the official marketplace OAuth flow. The access and refresh tokens we receive are stored server-side in the application database and are used only to call the marketplace APIs on behalf of your connected stores, such as reading stock and orders and writing stock updates. Tokens are never exposed in client applications or shared with third parties.
      </p>

      <H2>Sharing</H2>
      <p className="mt-3 text-muted-foreground">
        We do not share seller data with third parties. Data is only sent to the marketplace platform it belongs to, as required to run the features listed above.
      </p>

      {/* TODO: Tentukan dan tulis periode retensi data yang pasti (mis. inaktif X bulan) sebelum submit review. */}
      <H2>Retention and deletion</H2>
      <p className="mt-3 text-muted-foreground">
        We keep seller data for as long as your store connection is active or as needed to provide the service. When you ask us to delete your data, we remove the store records, mappings, and authorization tokens from our systems. To request deletion, contact us by email.
      </p>

      <H2>Revoking authorization</H2>
      <p className="mt-3 text-muted-foreground">
        You can revoke MAXIUS access at any time. You can remove the app from the authorization settings of your marketplace seller account, or disconnect the store in the MAXIUS settings page. After revocation, the stored tokens stop working, and no further stock or order data is synchronized.
      </p>

      <H2>Contact</H2>
      <p className="mt-3 text-muted-foreground">
        For privacy questions or data requests, email us at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-foreground hover:underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </div>
  );
}
