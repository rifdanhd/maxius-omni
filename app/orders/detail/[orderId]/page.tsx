import OrderDetailView from "@/components/orders/OrderDetailView";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return <OrderDetailView orderId={orderId} />;
}