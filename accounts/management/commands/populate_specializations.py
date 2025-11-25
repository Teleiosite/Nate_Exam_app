from django.core.management.base import BaseCommand
from accounts.models import EngineeringSpecialization

class Command(BaseCommand):
    help = 'Populate engineering specializations'

    def handle(self, *args, **options):
        specializations = [
            ("AE", "Aeronautical Engineering", "Aircraft and spacecraft design"),
            ("AG", "Agricultural Engineering", "Agricultural equipment and systems"),
            ("AI", "Artificial Intelligence and Robotics Engineering", "AI and robotics systems"),
            ("BM", "Biomedical Engineering", "Medical devices and systems"),
            ("CH", "Chemical Engineering", "Chemical processes and materials"),
            ("CV", "Civil Engineering", "Infrastructure and construction"),
            ("CS", "Computer Science Engineering", "Software and computing systems"),
            ("EE", "Electrical Engineering", "Electrical systems and power"),
            ("EC", "Electronics and Communication Engineering", "Electronic devices and communication"),
            ("ME", "Mechanical Engineering", "Mechanical systems and machinery"),
            ("MT", "Metallurgical Engineering", "Metals and materials processing"),
            ("MN", "Mining Engineering", "Mining operations and resources"),
            ("PE", "Petroleum Engineering", "Oil and gas extraction"),
            ("PR", "Production Engineering", "Manufacturing processes"),
            ("RB", "Robotics Engineering", "Robotic systems"),
            ("ST", "Structural Engineering", "Building structures"),
            ("TC", "Telecommunication Engineering", "Telecommunications systems"),
        ]
        
        for code, name, description in specializations:
            spec, created = EngineeringSpecialization.objects.get_or_create(
                code=code,
                defaults={'name': name, 'description': description}
            )
            if created:
                self.stdout.write(self.style.SUCCESS(f'Created: {name}'))
            else:
                self.stdout.write(f'Already exists: {name}')
        
        self.stdout.write(self.style.SUCCESS('Specializations populated successfully!'))
