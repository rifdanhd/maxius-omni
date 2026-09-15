-- CreateIndex
CREATE INDEX "Order_createTime_status_idx" ON "Order"("createTime", "status");

-- CreateIndex
CREATE INDEX "Order_accountId_createTime_idx" ON "Order"("accountId", "createTime");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_variantId_channelSku_idx" ON "OrderItem"("variantId", "channelSku");

-- CreateIndex
CREATE INDEX "SalesLog_variantId_time_idx" ON "SalesLog"("variantId", "time");

