package com.weatherapp.data

import com.weatherapp.BuildConfig
import com.weatherapp.data.api.WeatherApiService
import com.weatherapp.data.model.DailyForecast
import com.weatherapp.data.model.ForecastResponse
import com.weatherapp.data.model.WeatherResponse
import com.weatherapp.util.Resource
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class WeatherRepository(private val apiService: WeatherApiService) {

    private val apiKey: String = BuildConfig.WEATHER_API_KEY

    // -------------------------------------------------------------------------
    // Current weather
    // -------------------------------------------------------------------------

    suspend fun getCurrentWeatherByCity(
        city: String,
        units: String
    ): Resource<WeatherResponse> {
        return try {
            val response = apiService.getCurrentWeatherByCity(city, apiKey, units)
            if (response.isSuccessful) {
                response.body()?.let {
                    Resource.Success(it)
                } ?: Resource.Error("Empty response body")
            } else {
                val errorMsg = when (response.code()) {
                    401 -> "Invalid API key. Please check your OpenWeatherMap API key."
                    404 -> "City \"$city\" not found. Please check the spelling."
                    429 -> "Too many requests. Please wait a moment and try again."
                    else -> "Server error (${response.code()}). Please try again."
                }
                Resource.Error(errorMsg, response.code())
            }
        } catch (e: java.net.UnknownHostException) {
            Resource.Error("No internet connection. Please check your network.")
        } catch (e: java.net.SocketTimeoutException) {
            Resource.Error("Request timed out. Please try again.")
        } catch (e: Exception) {
            Resource.Error(e.localizedMessage ?: "An unexpected error occurred.")
        }
    }

    suspend fun getCurrentWeatherByCoords(
        lat: Double,
        lon: Double,
        units: String
    ): Resource<WeatherResponse> {
        return try {
            val response = apiService.getCurrentWeatherByCoords(lat, lon, apiKey, units)
            if (response.isSuccessful) {
                response.body()?.let {
                    Resource.Success(it)
                } ?: Resource.Error("Empty response body")
            } else {
                Resource.Error("Server error (${response.code()}). Please try again.", response.code())
            }
        } catch (e: java.net.UnknownHostException) {
            Resource.Error("No internet connection. Please check your network.")
        } catch (e: java.net.SocketTimeoutException) {
            Resource.Error("Request timed out. Please try again.")
        } catch (e: Exception) {
            Resource.Error(e.localizedMessage ?: "An unexpected error occurred.")
        }
    }

    // -------------------------------------------------------------------------
    // Forecast
    // -------------------------------------------------------------------------

    suspend fun getForecastByCity(
        city: String,
        units: String
    ): Resource<List<DailyForecast>> {
        return try {
            val response = apiService.getForecastByCity(city, apiKey, units)
            if (response.isSuccessful) {
                response.body()?.let {
                    Resource.Success(parseDailyForecasts(it))
                } ?: Resource.Error("Empty forecast response")
            } else {
                Resource.Error("Forecast error (${response.code()}).", response.code())
            }
        } catch (e: java.net.UnknownHostException) {
            Resource.Error("No internet connection.")
        } catch (e: Exception) {
            Resource.Error(e.localizedMessage ?: "Forecast fetch failed.")
        }
    }

    suspend fun getForecastByCoords(
        lat: Double,
        lon: Double,
        units: String
    ): Resource<List<DailyForecast>> {
        return try {
            val response = apiService.getForecastByCoords(lat, lon, apiKey, units)
            if (response.isSuccessful) {
                response.body()?.let {
                    Resource.Success(parseDailyForecasts(it))
                } ?: Resource.Error("Empty forecast response")
            } else {
                Resource.Error("Forecast error (${response.code()}).", response.code())
            }
        } catch (e: java.net.UnknownHostException) {
            Resource.Error("No internet connection.")
        } catch (e: Exception) {
            Resource.Error(e.localizedMessage ?: "Forecast fetch failed.")
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * The OpenWeatherMap /forecast endpoint returns up to 40 entries (every 3 hours
     * over 5 days). Group by calendar date and derive a single daily summary per day.
     * Skip today (index 0) so we show the next 5 distinct days.
     */
    private fun parseDailyForecasts(response: ForecastResponse): List<DailyForecast> {
        val dayFormat = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val labelFormat = SimpleDateFormat("EEE", Locale.getDefault())
        val fullFormat = SimpleDateFormat("EEE, MMM d", Locale.getDefault())

        val grouped = response.list.groupBy { item ->
            dayFormat.format(Date(item.dt * 1000L))
        }

        val today = dayFormat.format(Date())

        return grouped
            .filter { (dateKey, _) -> dateKey != today }
            .entries
            .take(5)
            .map { (_, items) ->
                val date = Date(items.first().dt * 1000L)
                val minTemp = items.minOf { it.main.tempMin }
                val maxTemp = items.maxOf { it.main.tempMax }
                val middayItem = items.getOrElse(items.size / 2) { items.first() }
                val maxPop = items.maxOf { it.pop }

                DailyForecast(
                    dateLabel = labelFormat.format(date),
                    dateFull = fullFormat.format(date),
                    iconCode = middayItem.weather.firstOrNull()?.icon ?: "01d",
                    description = middayItem.weather.firstOrNull()?.description?.replaceFirstChar {
                        it.uppercase(Locale.getDefault())
                    } ?: "",
                    tempMin = minTemp,
                    tempMax = maxTemp,
                    humidity = middayItem.main.humidity,
                    windSpeed = middayItem.wind.speed,
                    pop = maxPop
                )
            }
    }
}
