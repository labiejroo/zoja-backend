import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import { ListVisitSlotsQueryDto } from "../visits/dto/list-visit-slots.query.js";
import {
  AdminVisitSlotsService,
  type AdminVisitSlotView,
} from "./admin-visit-slots.service.js";
import { CreateVisitSlotDto } from "./dto/create-visit-slot.dto.js";
import { UpdateVisitSlotDto } from "./dto/update-visit-slot.dto.js";

/**
 * Panel gospodarzy — operacje na terminach. Pełna ścieżka: /api/admin/visit-slots
 *
 * Query DTO współdzielimy z widokiem publicznym: zakres dat ma być walidowany
 * tak samo po obu stronach, żeby panel nie przepuszczał zapytań, których
 * strona gościa nie przepuszcza.
 */
@Controller("admin/visit-slots")
export class AdminVisitSlotsController {
  constructor(private readonly service: AdminVisitSlotsService) {}

  @Get()
  list(@Query() query: ListVisitSlotsQueryDto): Promise<AdminVisitSlotView[]> {
    return this.service.findInRange(query.from, query.to);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateVisitSlotDto): Promise<AdminVisitSlotView> {
    return this.service.create(dto);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateVisitSlotDto,
  ): Promise<AdminVisitSlotView> {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.service.remove(id);
  }
}
