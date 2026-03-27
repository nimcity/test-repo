package com.weatherapp.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.weatherapp.data.model.DailyForecast
import com.weatherapp.databinding.ItemForecastBinding
import com.weatherapp.util.Constants
import kotlin.math.roundToInt

class ForecastAdapter : ListAdapter<DailyForecast, ForecastAdapter.ForecastViewHolder>(DiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ForecastViewHolder {
        val binding = ItemForecastBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ForecastViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ForecastViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    class ForecastViewHolder(private val binding: ItemForecastBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(item: DailyForecast) {
            binding.tvDay.text = item.dateLabel
            binding.tvDate.text = item.dateFull
            binding.tvForecastDesc.text = item.description.replaceFirstChar { it.uppercase() }
            binding.tvTempRange.text = "${item.tempMin.roundToInt()}° / ${item.tempMax.roundToInt()}°"
            binding.tvForecastHumidity.text = "${item.humidity}%"
            binding.tvPrecipitation.text = "${(item.pop * 100).roundToInt()}%"

            val iconUrl = "${Constants.ICON_URL}${item.iconCode}${Constants.ICON_SUFFIX}"
            Glide.with(binding.root.context).load(iconUrl).into(binding.ivForecastIcon)
        }
    }

    class DiffCallback : DiffUtil.ItemCallback<DailyForecast>() {
        override fun areItemsTheSame(oldItem: DailyForecast, newItem: DailyForecast) =
            oldItem.dateLabel == newItem.dateLabel

        override fun areContentsTheSame(oldItem: DailyForecast, newItem: DailyForecast) =
            oldItem == newItem
    }
}
