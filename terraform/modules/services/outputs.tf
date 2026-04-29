output "django_service_name" {
  value = aws_ecs_service.django.name
}

output "next_service_name" {
  value = aws_ecs_service.next.name
}

output "celery_worker_service_name" {
  value = aws_ecs_service.celery_worker.name
}

output "celery_beat_service_name" {
  value = aws_ecs_service.celery_beat.name
}

output "service_names_csv" {
  description = "cd-stg.yml の vars.ECS_SERVICES に貼る用 (カンマ区切り)"
  value = join(",", [
    aws_ecs_service.django.name,
    aws_ecs_service.next.name,
    aws_ecs_service.celery_worker.name,
    aws_ecs_service.celery_beat.name,
  ])
}

output "migrate_task_definition_family" {
  description = "cd-stg.yml の vars.ECS_MIGRATE_TASK_DEFINITION に貼る (revision なしの family 形式で常に最新が使われる)"
  value       = aws_ecs_task_definition.django_migrate.family
}
