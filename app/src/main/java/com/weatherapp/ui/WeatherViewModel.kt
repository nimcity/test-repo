package com.weatherapp.ui

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import com.weatherapp.data.WeatherRepository
import com.weatherapp.data.api.RetrofitClient
import com.weatherapp.data.model.DailyForecast
import com.weatherapp.data.model.WeatherResponse
import com.weatherapp.util.Constants
import com.weatherapp.util.Resource
import kotlinx.coroutines.launch

class WeatherViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = WeatherRepository(RetrofitClient.weatherApiService)
    private val prefs = application.getSharedPreferences(Constants.PREF_NAME, Context.MODE_PRIVATE)

    // -------------------------------------------------------------------------
    // LiveData
    // -------------------------------------------------------------------------

    private val _currentWeather = MutableLiveData<Resource<WeatherResponse>>()
    val currentWeather: LiveData<Resource<WeatherResponse>> = _currentWeather

    private val _forecast = MutableLiveData<Resource<List<DailyForecast>>>()
    val forecast: LiveData<Resource<List<DailyForecast>>> = _forecast

    private val _unit = MutableLiveData<String>()
    val unit: LiveData<String> = _unit

    private val _lastCity = MutableLiveData<String>()
    val lastCity: LiveData<String> = _lastCity

    // -------------------------------------------------------------------------
    // Init
    // -------------------------------------------------------------------------

    init {
        val savedUnit = prefs.getString(Constants.PREF_UNIT, Constants.UNIT_METRIC) ?: Constants.UNIT_METRIC
        _unit.value = savedUnit

        val savedCity = prefs.getString(Constants.PREF_LAST_CITY, "") ?: ""
        if (savedCity.isNotBlank()) {
            _lastCity.value = savedCity
            fetchWeatherByCity(savedCity)
        }
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    fun fetchWeatherByCity(city: String) {
        val trimmed = city.trim()
        if (trimmed.isBlank()) return

        saveLastCity(trimmed)
        val units = _unit.value ?: Constants.UNIT_METRIC

        viewModelScope.launch {
            _currentWeather.value = Resource.Loading
            _forecast.value = Resource.Loading

            val weatherResult = repository.getCurrentWeatherByCity(trimmed, units)
            _currentWeather.value = weatherResult

            if (weatherResult is Resource.Success) {
                val forecastResult = repository.getForecastByCity(trimmed, units)
                _forecast.value = forecastResult
            } else if (weatherResult is Resource.Error) {
                _forecast.value = Resource.Error(weatherResult.message)
            }
        }
    }

    fun fetchWeatherByCoords(lat: Double, lon: Double) {
        val units = _unit.value ?: Constants.UNIT_METRIC

        viewModelScope.launch {
            _currentWeather.value = Resource.Loading
            _forecast.value = Resource.Loading

            val weatherResult = repository.getCurrentWeatherByCoords(lat, lon, units)
            _currentWeather.value = weatherResult

            if (weatherResult is Resource.Success) {
                // Save the resolved city name so next launch reuses it
                saveLastCity(weatherResult.data.name)
                val forecastResult = repository.getForecastByCoords(lat, lon, units)
                _forecast.value = forecastResult
            } else if (weatherResult is Resource.Error) {
                _forecast.value = Resource.Error(weatherResult.message)
            }
        }
    }

    fun toggleUnit() {
        val current = _unit.value ?: Constants.UNIT_METRIC
        val newUnit = if (current == Constants.UNIT_METRIC) Constants.UNIT_IMPERIAL else Constants.UNIT_METRIC
        _unit.value = newUnit
        prefs.edit().putString(Constants.PREF_UNIT, newUnit).apply()

        // Re-fetch with the new unit
        val lastCity = prefs.getString(Constants.PREF_LAST_CITY, "") ?: ""
        if (lastCity.isNotBlank()) {
            fetchWeatherByCity(lastCity)
        }
    }

    fun refresh() {
        val lastCity = prefs.getString(Constants.PREF_LAST_CITY, "") ?: ""
        if (lastCity.isNotBlank()) {
            fetchWeatherByCity(lastCity)
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private fun saveLastCity(city: String) {
        prefs.edit().putString(Constants.PREF_LAST_CITY, city).apply()
    }

    fun isCelsius(): Boolean = (_unit.value ?: Constants.UNIT_METRIC) == Constants.UNIT_METRIC

    fun formatTemp(temp: Double): String {
        val symbol = if (isCelsius()) "°C" else "°F"
        return "${temp.toInt()}$symbol"
    }

    fun formatWindSpeed(speed: Double): String {
        return if (isCelsius()) "${speed.toInt()} m/s" else "${speed.toInt()} mph"
    }
}
