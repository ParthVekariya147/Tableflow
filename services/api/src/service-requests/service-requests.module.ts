import { Module } from "@nestjs/common";
import { ServiceRequestsService } from "./service-requests.service.js";
import { ServiceRequestsController } from "./service-requests.controller.js";
import { ServiceRequestsEvents } from "./service-requests.events.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  providers: [ServiceRequestsService, ServiceRequestsEvents],
  controllers: [ServiceRequestsController],
})
export class ServiceRequestsModule {}
