package com.weatherapp.util

object Constants {
    const val BASE_URL = "https://api.openweathermap.org/data/2.5/"
    const val ICON_URL = "https://openweathermap.org/img/wn/"
    const val ICON_SUFFIX = "@2x.png"

    const val UNIT_METRIC = "metric"
    const val UNIT_IMPERIAL = "imperial"

    const val PREF_NAME = "weather_prefs"
    const val PREF_UNIT = "unit"
    const val PREF_LAST_CITY = "last_city"

    const val LOCATION_PERMISSION_REQUEST_CODE = 1001

    const val FORECAST_DAYS = 5
    const val FORECAST_COUNT = 40 // 5 days × 8 three-hour slots
}
