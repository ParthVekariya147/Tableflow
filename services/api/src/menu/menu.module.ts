import { Module } from "@nestjs/common";
import { MenuService } from "./menu.service.js";
import { MenuController } from "./menu.controller.js";

@Module({
  providers: [MenuService],
  controllers: [MenuController],
})
export class MenuModule {}
