from django import forms

from .models import BugReport


class BugReportForm(forms.ModelForm):
    website = forms.CharField(
        required=False,
        widget=forms.HiddenInput,
        label='Leave blank',
    )

    class Meta:
        model = BugReport
        fields = (
            'name',
            'email',
            'category',
            'page_url',
            'summary',
            'details',
            'severity',
        )
        widgets = {
            'name': forms.TextInput(attrs={'class': 'input', 'autocomplete': 'name'}),
            'email': forms.EmailInput(attrs={'class': 'input', 'autocomplete': 'email'}),
            'category': forms.Select(attrs={'class': 'select'}),
            'page_url': forms.URLInput(attrs={'class': 'input', 'autocomplete': 'url'}),
            'summary': forms.TextInput(attrs={'class': 'input'}),
            'details': forms.Textarea(attrs={'class': 'textarea', 'rows': 8}),
            'severity': forms.Select(attrs={'class': 'select'}),
        }
        labels = {
            'page_url': 'Page URL',
            'summary': 'Short summary',
            'details': 'What happened?',
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['category'].required = False
        self.fields['severity'].required = False
        self.fields['category'].choices = [
            ('', 'Choose a category'),
            *BugReport.Category.choices,
        ]
        self.fields['severity'].choices = [
            ('', 'Choose severity'),
            *BugReport.Severity.choices,
        ]

    def clean_website(self):
        value = self.cleaned_data.get('website', '').strip()
        if value:
            raise forms.ValidationError('Invalid submission.')
        return ''

    def clean(self):
        cleaned_data = super().clean()
        for field_name, value in list(cleaned_data.items()):
            if isinstance(value, str):
                cleaned_data[field_name] = value.strip()
        return cleaned_data

    def clean_summary(self):
        return self._clean_required_text('summary')

    def clean_details(self):
        return self._clean_required_text('details')

    def _clean_required_text(self, field_name: str) -> str:
        value = (self.cleaned_data.get(field_name) or '').strip()
        if not value:
            raise forms.ValidationError('This field cannot be blank.')
        return value
