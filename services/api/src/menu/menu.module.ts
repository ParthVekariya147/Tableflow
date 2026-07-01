import { Module } from "@nestjs/common";
import { MenuService } from "./menu.service.js";
import { MenuController } from "./menu.controller.js";
import { StorageModule } from "../storage/storage.module.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [StorageModule, AuthModule],
  providers: [MenuService],
  controllers: [MenuController],
})
export class MenuModule {}
